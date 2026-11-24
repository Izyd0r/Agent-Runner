using System.Diagnostics;
using System.Text;

namespace AgentHub.Api.Services;

public static class Git
{
    /// Runs git with ArgumentList (no shell, no injection). Token goes via env vars,
    /// so it never appears in argv, .git/config, or logs.
    public static async Task<string> RunAsync(
        string? workingDir, IEnumerable<string> args, string? token = null,
        TimeSpan? timeout = null, CancellationToken ct = default)
    {
        var psi = new ProcessStartInfo("git")
        {
            WorkingDirectory = workingDir ?? Environment.CurrentDirectory,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        psi.Environment["GIT_TERMINAL_PROMPT"] = "0";
        if (!string.IsNullOrEmpty(token))
        {
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"x-access-token:{token}"));
            psi.Environment["GIT_CONFIG_COUNT"] = "1";
            psi.Environment["GIT_CONFIG_KEY_0"] = "http.extraHeader";
            psi.Environment["GIT_CONFIG_VALUE_0"] = $"Authorization: Basic {basic}";
        }

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("git failed to start");
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout ?? TimeSpan.FromMinutes(5));

        try
        {
            var stdout = proc.StandardOutput.ReadToEndAsync(cts.Token);
            var stderr = proc.StandardError.ReadToEndAsync(cts.Token);
            await proc.WaitForExitAsync(cts.Token);
            var (o, e) = (await stdout, await stderr);
            if (proc.ExitCode != 0)
                throw new GitException($"git {string.Join(' ', args.Take(2))} failed ({proc.ExitCode}): {e.Trim()}");
            return o.Trim();
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch { }
            throw;
        }
    }
}

public sealed class GitException(string message) : Exception(message);