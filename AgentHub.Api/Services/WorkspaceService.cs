using System.Collections.Concurrent;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Options;

namespace AgentHub.Api.Services;

public sealed class WorkspaceOptions { public string Root { get; set; } = ""; }

public sealed record RunWorkspace(string Path, string Branch, string BaseBranch);

public sealed partial class WorkspaceService(IOptions<WorkspaceOptions> opts)
{
    private readonly string _root = System.IO.Path.GetFullPath(opts.Value.Root);
    private static readonly ConcurrentDictionary<Guid, SemaphoreSlim> Locks = new();

    private string ProjectDir(Guid projectId) => System.IO.Path.Combine(_root, projectId.ToString("N"));
    private string BareDir(Guid projectId) => System.IO.Path.Combine(ProjectDir(projectId), "repo.git");
    private string RunsDir(Guid projectId) => System.IO.Path.Combine(ProjectDir(projectId), "runs");
    private string RunDir(Guid projectId, Guid runId) =>
        System.IO.Path.Combine(RunsDir(projectId), runId.ToString("N"));

    private static SemaphoreSlim LockFor(Guid projectId) =>
        Locks.GetOrAdd(projectId, _ => new SemaphoreSlim(1, 1));

    [GeneratedRegex(@"^https://github\.com/[\w.-]+/[\w.-]+?(\.git)?/?$")]
    private static partial Regex GitHubUrl();

    public static bool IsValidUrl(string url) => GitHubUrl().IsMatch(url);
    public bool IsCloned(Guid projectId) => Directory.Exists(BareDir(projectId));

    /// Makes the local mirror identical to the remote and discards all local work
    /// (run worktrees + agent/* branches). Clones on first call.
    public async Task<(string DefaultBranch, string Commit)> SyncAsync(
        Guid projectId, string url, string? token, CancellationToken ct = default)
    {
        if (!IsValidUrl(url)) throw new ArgumentException("Only https://github.com/owner/repo URLs are allowed.");

        var sem = LockFor(projectId);
        await sem.WaitAsync(ct);
        try
        {
            var bare = BareDir(projectId);

            if (!Directory.Exists(bare))
            {
                Directory.CreateDirectory(ProjectDir(projectId));
                await Git.RunAsync(ProjectDir(projectId),
                    ["clone", "--bare", "--quiet", "--", url, bare], token, ct: ct);
                await Git.RunAsync(bare,
                    ["config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*"], ct: ct);
            }

            // 1. Discard local changes: delete all run worktrees, prune git's records
            var runs = RunsDir(projectId);
            if (Directory.Exists(runs)) Directory.Delete(runs, recursive: true);
            await Git.RunAsync(bare, ["worktree", "prune"], ct: ct);

            // 2. Delete local agent branches
            var agentBranches = await Git.RunAsync(bare,
                ["for-each-ref", "--format=%(refname:short)", "refs/heads/agent/"], ct: ct);
            foreach (var b in agentBranches.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                await Git.RunAsync(bare, ["branch", "-D", b.Trim()], ct: ct);

            // 3. Pull everything from remote (forced; deleted remote branches are pruned)
            await Git.RunAsync(bare, ["fetch", "--prune", "--force", "--quiet", "origin"], token, ct: ct);

            // 4. Ask the remote for its current default branch
            var symref = await Git.RunAsync(bare, ["ls-remote", "--symref", "origin", "HEAD"], token, ct: ct);
            var first = symref.Split('\n')[0];   // "ref: refs/heads/main\tHEAD"
            const string prefix = "ref: refs/heads/";
            if (!first.StartsWith(prefix)) throw new GitException("Could not determine remote default branch.");
            var defaultBranch = first[prefix.Length..].Split('\t')[0];

            var commit = await Git.RunAsync(bare, ["rev-parse", $"origin/{defaultBranch}"], ct: ct);
            return (defaultBranch, commit);
        }
        finally { sem.Release(); }
    }

    // WorkspaceService: fetch only, no wiping
    public async Task<string> FetchAsync(Guid projectId, string url, string? token, CancellationToken ct = default)
    {
        var sem = LockFor(projectId);
        await sem.WaitAsync(ct);
        try
        {
            var bare = BareDir(projectId);
            await Git.RunAsync(bare, ["fetch", "--prune", "--force", "--quiet", "origin"], token, ct: ct);
            var symref = await Git.RunAsync(bare, ["ls-remote", "--symref", "origin", "HEAD"], token, ct: ct);
            const string prefix = "ref: refs/heads/";
            var first = symref.Split('\n')[0];
            if (!first.StartsWith(prefix)) throw new GitException("Could not determine remote default branch.");
            return first[prefix.Length..].Split('\t')[0];
        }
        finally { sem.Release(); }
    }

    /// Removes the worktree (and local branch). Safe to call twice.
    public async Task CleanupRunAsync(Guid projectId, Guid runId, string? branch = null, CancellationToken ct = default)
    {
        var bare = BareDir(projectId);
        var path = RunDir(projectId, runId);

        var sem = LockFor(projectId);
        await sem.WaitAsync(ct);
        try
        {
            if (Directory.Exists(path))
                await Git.RunAsync(bare, ["worktree", "remove", "--force", path], ct: ct);
            await Git.RunAsync(bare, ["worktree", "prune"], ct: ct);
            if (branch is not null)
                try { await Git.RunAsync(bare, ["branch", "-D", branch], ct: ct); } catch (GitException) { }
        }
        finally { sem.Release(); }
    }

    public async Task<RunWorkspace> CreateRunWorkspaceAsync(
        Guid projectId, Guid runId, Guid taskId, string taskTitle,
        string agentName, int attempt, string defaultBranch, CancellationToken ct = default)
    {
        var bare = BareDir(projectId);
        var path = RunDir(projectId, runId);

        var taskPart = $"{taskId.ToString("N")[..8]}-{Slugify(taskTitle, 24)}";
        var agentPart = Slugify(agentName, 16);
        var branch = $"agent/{taskPart}/{agentPart}-try-{attempt}";

        Directory.CreateDirectory(RunsDir(projectId));

        var sem = LockFor(projectId);
        await sem.WaitAsync(ct);
        try
        {
            await Git.RunAsync(bare,
                ["worktree", "add", "-b", branch, path, $"origin/{defaultBranch}"], ct: ct);
        }
        finally { sem.Release(); }

        return new RunWorkspace(path, branch, defaultBranch);
    }

    private static string Slugify(string s, int maxLen = 30)
    {
        var slug = Regex.Replace(s.ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-');
        return slug.Length == 0 ? "item" : slug[..Math.Min(slug.Length, maxLen)];
    }
}