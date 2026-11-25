using System.Diagnostics;
using System.Text.Json;

namespace AgentHub.Api.Services;

public sealed class AgentTools(string root)
{
    private readonly string _root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar);

    private static readonly HashSet<string> AllowedCommands = ["dotnet", "npm", "pytest"];

    public static readonly object[] Definitions =
    [
        Def("list_files", "List files and folders in a directory. Use '.' for the repo root.",
            new { path = Str("Relative directory path") }, ["path"]),
        Def("read_file", "Read a text file.",
            new { path = Str("Relative file path") }, ["path"]),
        Def("write_file", "Create a new file, or completely overwrite an existing one.",
            new { path = Str("Relative file path"), content = Str("Full file content") }, ["path", "content"]),
        Def("replace_in_file", "Replace one exact piece of text in a file. 'old' must appear exactly once.",
            new { path = Str("Relative file path"), old = Str("Exact text to find"), @new = Str("Replacement text") },
            ["path", "old", "new"]),
        Def("run_command", "Run a build or test command. Allowed executables: dotnet, npm, pytest.",
            new { command = Str("Executable name"), args = new { type = "array", items = new { type = "string" } } },
            ["command"]),
    ];

    private static object Str(string description) => new { type = "string", description };

    private static object Def(string name, string description, object props, string[] required) => new
    {
        type = "function",
        function = new
        {
            name,
            description,
            parameters = new { type = "object", properties = props, required }
        }
    };

    private string Safe(string rel)
    {
        var full = Path.GetFullPath(Path.Combine(_root, rel));
        if (full != _root && !full.StartsWith(_root + Path.DirectorySeparatorChar))
            throw new InvalidOperationException("Path escapes the workspace.");
        if (Path.GetRelativePath(_root, full).Split(Path.DirectorySeparatorChar).Contains(".git"))
            throw new InvalidOperationException(".git is off limits.");
        return full;
    }

    private static string Arg(JsonElement a, string name) =>
        a.ValueKind == JsonValueKind.Object && a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()!
            : throw new InvalidOperationException($"Missing string argument '{name}'.");

    /// Never throws: errors are returned as text so the model can correct itself.
    public async Task<string> ExecuteAsync(string name, JsonElement a, CancellationToken ct)
    {
        try
        {
            switch (name)
            {
                case "list_files":
                    {
                        var dir = Safe(Arg(a, "path"));
                        var entries = Directory.EnumerateFileSystemEntries(dir)
                            .Where(p => Path.GetFileName(p) != ".git")
                            .Select(p => Path.GetRelativePath(_root, p) + (Directory.Exists(p) ? "/" : ""))
                            .OrderBy(p => p).Take(200);
                        return string.Join('\n', entries);
                    }
                case "read_file":
                    {
                        var text = await File.ReadAllTextAsync(Safe(Arg(a, "path")), ct);
                        return text.Length > 8_000 ? text[..8_000] + "\n...[truncated]" : text;
                    }
                case "write_file":
                    {
                        var p = Safe(Arg(a, "path"));
                        Directory.CreateDirectory(Path.GetDirectoryName(p)!);
                        await File.WriteAllTextAsync(p, Arg(a, "content"), ct);
                        return "ok";
                    }
                case "replace_in_file":
                    {
                        var p = Safe(Arg(a, "path"));
                        var text = await File.ReadAllTextAsync(p, ct);
                        var old = Arg(a, "old");
                        var count = text.Split(old).Length - 1;
                        if (count == 0) return "error: 'old' text not found. Read the file again and copy it exactly.";
                        if (count > 1) return $"error: 'old' text appears {count} times. Include more surrounding lines.";
                        await File.WriteAllTextAsync(p, text.Replace(old, Arg(a, "new")), ct);
                        return "ok";
                    }
                case "run_command":
                    {
                        var cmd = Arg(a, "command");
                        if (!AllowedCommands.Contains(cmd)) return $"error: '{cmd}' is not allowed.";
                        var args = a.TryGetProperty("args", out var arr) && arr.ValueKind == JsonValueKind.Array
                            ? arr.EnumerateArray().Select(x => x.GetString() ?? "").ToList()
                            : [];
                        return await RunProcessAsync(cmd, args, ct);
                    }
                default:
                    return $"error: unknown tool '{name}'.";
            }
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception e) { return $"error: {e.Message}"; }
    }

    private async Task<string> RunProcessAsync(string cmd, List<string> args, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(cmd)
        {
            WorkingDirectory = _root,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var x in args) psi.ArgumentList.Add(x);

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Process failed to start.");
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromMinutes(2));
        try
        {
            var o = proc.StandardOutput.ReadToEndAsync(cts.Token);
            var e = proc.StandardError.ReadToEndAsync(cts.Token);
            await proc.WaitForExitAsync(cts.Token);
            var s = $"exit code {proc.ExitCode}\n{await o}\n{await e}";
            return s.Length > 4_000 ? "...[truncated]\n" + s[^4_000..] : s;
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch { }
            if (ct.IsCancellationRequested) throw;
            return "error: command timed out after 2 minutes.";
        }
    }
}