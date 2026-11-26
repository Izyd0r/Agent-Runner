using AgentHub.Api.Services;
using Microsoft.EntityFrameworkCore;

public static class RunEndpoints
{
    public static void MapRunEndpoints(this IEndpointRouteBuilder proj)
    {
        proj.MapPost("/tasks/{taskId:guid}/run", async (Guid projectId, Guid taskId, AppDb db, RunQueue queue) =>
        {
            var t = await db.Tasks.FirstOrDefaultAsync(x => x.Id == taskId && x.ProjectId == projectId);
            if (t is null) return Results.NotFound();
            if (t.AssigneeAgentId is null) return Results.BadRequest("Task has no agent assigned");

            var active = await db.Runs.AnyAsync(r => r.TaskId == taskId &&
                (r.Status == RunStatus.Queued || r.Status == RunStatus.Running));
            if (active) return Results.Conflict("This task already has an active run");

            var run = new AgentRun { TaskId = t.Id, AgentId = t.AssigneeAgentId.Value };
            db.Runs.Add(run);
            // Columns are user-defined now, so starting a run no longer moves the task anywhere.
            // On success, AgentRunner moves it to the project's review column (if one is flagged).
            await db.SaveChangesAsync();
            await queue.EnqueueAsync(run.Id);

            return Results.Accepted($"/api/projects/{projectId}/runs/{run.Id}", run);
        }).WithTags("Runs");

        proj.MapGet("/runs", async (Guid projectId, AppDb db) =>
            await db.Runs
                .Where(r => db.Tasks.Any(t => t.Id == r.TaskId && t.ProjectId == projectId))
                .OrderByDescending(r => r.StartedAt)
                .Take(100)
                .ToListAsync()
        ).WithTags("Runs");

        proj.MapGet("/runs/{runId:guid}", async (Guid projectId, Guid runId, AppDb db) =>
        {
            var run = await db.Runs.FirstOrDefaultAsync(r => r.Id == runId &&
                db.Tasks.Any(t => t.Id == r.TaskId && t.ProjectId == projectId));
            return run is null ? Results.NotFound() : Results.Ok(run);
        }).WithTags("Runs");

        // Polling: GET /runs/{id}/logs?after=0, then repeat with the last log Id you received.
        proj.MapGet("/runs/{runId:guid}/logs", async (Guid projectId, Guid runId, long? after, AppDb db) =>
        {
            var owns = await db.Runs.AnyAsync(r => r.Id == runId &&
                db.Tasks.Any(t => t.Id == r.TaskId && t.ProjectId == projectId));
            if (!owns) return Results.NotFound();

            var logs = await db.RunLogs
                .Where(l => l.RunId == runId && l.Id > (after ?? 0))
                .OrderBy(l => l.Id).ToListAsync();
            return Results.Ok(logs);
        }).WithTags("Runs");
    }
}