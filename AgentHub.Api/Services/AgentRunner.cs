using Microsoft.EntityFrameworkCore;

namespace AgentHub.Api.Services;

public sealed class AgentRunner(
    RunQueue queue, IServiceScopeFactory scopes, IConfiguration config, ILogger<AgentRunner> log)
    : BackgroundService
{
    private const int MaxSteps = 25;
    private const int NumCtx = 16384;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await RecoverAsync(stop);

        await foreach (var runId in queue.ReadAllAsync(stop))
        {
            try { await RunOneAsync(runId, stop); }
            catch (Exception e) { log.LogError(e, "Unhandled error in run {RunId}", runId); }
        }
    }

    /// The queue lives in memory, so after a restart nothing is actually running.
    private async Task RecoverAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        await db.Runs
            .Where(r => r.Status == RunStatus.Queued || r.Status == RunStatus.Running)
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.Status, RunStatus.Failed)
                .SetProperty(r => r.FinishedAt, DateTime.UtcNow), ct);
    }

    private async Task RunOneAsync(Guid runId, CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDb>();
        var ws = scope.ServiceProvider.GetRequiredService<WorkspaceService>();
        var ollama = scope.ServiceProvider.GetRequiredService<OllamaClient>();

        var run = await db.Runs.FindAsync([runId], ct);
        if (run is null) return;
        var task = await db.Tasks.FindAsync([run.TaskId], ct);
        var agent = await db.Agents.FindAsync([run.AgentId], ct);
        var project = task is null ? null : await db.Projects.FindAsync([task.ProjectId], ct);

        // Logs use CancellationToken.None so they are still written during shutdown/cancel.
        async Task Log(string kind, string message)
        {
            db.RunLogs.Add(new AgentRunLog { RunId = runId, Kind = kind, Message = message });
            await db.SaveChangesAsync(CancellationToken.None);
        }

        RunWorkspace? w = null;
        var keepWorkspace = false;

        try
        {
            if (task is null || agent is null || project is null)
                throw new InvalidOperationException("Run references a missing task, agent or project.");
            if (string.IsNullOrEmpty(project.GitHubUrl))
                throw new InvalidOperationException("Project has no GitHub URL.");

            run.Status = RunStatus.Running;
            await db.SaveChangesAsync(ct);

            var token = config["GitHub:Token"];

            // Clone on first use, otherwise just fetch (Sync would wipe other runs' worktrees).
            string defaultBranch;
            if (!ws.IsCloned(project.Id))
            {
                await Log("info", "Cloning repository...");
                defaultBranch = (await ws.SyncAsync(project.Id, project.GitHubUrl, token, ct)).DefaultBranch;
            }
            else
            {
                defaultBranch = await ws.FetchAsync(project.Id, project.GitHubUrl, token, ct);
            }

            var attempt = await db.Runs
                .Where(r => r.TaskId == task.Id && r.Id != run.Id)
                .CountAsync(ct) + 1;

            w = await ws.CreateRunWorkspaceAsync(
                project.Id, runId, task.Id, task.Title, agent.Name, attempt, defaultBranch, ct);
            await Log("info", $"Attempt #{attempt} by {agent.Name} on branch {w.Branch} (from {defaultBranch})");

            var tools = new AgentTools(w.Path);
            var messages = new List<ChatMessage>
            {
                new("system",
                    agent.SystemPrompt + "\n\n" +
                    "You are working inside a git repository using the provided tools. " +
                    "Explore with list_files and read_file, and only read what you need. " +
                    "Prefer replace_in_file for small edits. Verify with run_command when a build or test exists. " +
                    "When you are done, reply with a short summary and make no tool calls."),
                new("user", $"Task: {task.Title}\n\n{task.Description}")
            };

            var finished = false;
            for (var step = 1; step <= MaxSteps; step++)
            {
                var result = await ollama.ChatAsync(agent.Model, agent.Temperature, messages, AgentTools.Definitions, ct);
                var reply = result.Message;
                messages.Add(reply);
                await Log("info", $"step {step}: ~{result.PromptTokens}/{NumCtx} prompt tokens, {result.OutputTokens} generated");

                if (reply.ToolCalls is not { Count: > 0 })
                {
                    await Log("message", string.IsNullOrWhiteSpace(reply.Content) ? "(empty reply)" : reply.Content);
                    finished = true;
                    break;
                }

                foreach (var call in reply.ToolCalls)
                {
                    await Log("tool_call", $"{call.Function.Name} {call.Function.Arguments}");
                    var output = await tools.ExecuteAsync(call.Function.Name, call.Function.Arguments, ct);
                    await Log("tool_result", output.Length > 2000 ? output[..2000] + "…" : output);
                    messages.Add(new ChatMessage("tool", output, ToolName: call.Function.Name));
                }
            }

            if (!finished) await Log("error", $"Stopped: step limit ({MaxSteps}) reached.");

            // Commit and push whatever the agent produced (even partial work, for inspection).
            await Git.RunAsync(w.Path, ["add", "-A"], ct: ct);
            var status = await Git.RunAsync(w.Path, ["status", "--porcelain"], ct: ct);
            if (status.Length == 0)
            {
                await Log("info", "No file changes were made.");
            }
            else
            {
                await Git.RunAsync(w.Path,
                    ["-c", "user.name=AgentHub", "-c", "user.email=agent@agenthub.local",
                     "commit", "-m", $"agent: {task.Title}"], ct: ct);

                if (string.IsNullOrEmpty(token))
                {
                    keepWorkspace = true;
                    await Log("info", $"Committed locally, but no GitHub token is configured, so nothing was pushed. Worktree kept at {w.Path}");
                }
                else
                {
                    await Git.RunAsync(w.Path, ["push", "origin", w.Branch], token, ct: ct);
                    await Log("info", $"Pushed branch {w.Branch}");
                }
            }

            run.Status = finished ? RunStatus.Succeeded : RunStatus.Failed;
            if (finished) task.Status = TaskItemStatus.Review;
        }
        catch (Exception e)
        {
            log.LogError(e, "Run {RunId} failed", runId);
            await Log("error", e is OperationCanceledException ? "Run cancelled." : e.Message);
            run.Status = RunStatus.Failed;
        }
        finally
        {
            run.FinishedAt = DateTime.UtcNow;
            await db.SaveChangesAsync(CancellationToken.None);

            if (w is not null && !keepWorkspace && project is not null)
            {
                try { await ws.CleanupRunAsync(project.Id, runId, w.Branch, CancellationToken.None); }
                catch (Exception e) { log.LogWarning(e, "Cleanup failed for run {RunId}", runId); }
            }
        }
    }
}