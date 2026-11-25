using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AgentHub.Api.Services;

public sealed partial class GitHubService(HttpClient http)
{
    [GeneratedRegex(@"^https://github\.com/(?<owner>[\w.-]+)/(?<repo>[\w.-]+?)(?:\.git)?/?$")]
    private static partial Regex RepoRegex();

    public async Task<string?> CreatePullRequestAsync(
        string repoUrl, string token, string headBranch, string baseBranch,
        string title, string body, CancellationToken ct = default)
    {
        var match = RepoRegex().Match(repoUrl);
        if (!match.Success) return null;

        var owner = match.Groups["owner"].Value;
        var repo = match.Groups["repo"].Value;

        using var req = new HttpRequestMessage(HttpMethod.Post, $"https://api.github.com/repos/{owner}/{repo}/pulls");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.UserAgent.ParseAdd("AgentHub");
        req.Headers.Accept.ParseAdd("application/vnd.github+json");
        req.Content = JsonContent.Create(new
        {
            title,
            head = headBranch,
            @base = baseBranch,
            body
        });

        using var res = await http.SendAsync(req, ct);
        if (!res.IsSuccessStatusCode)
        {
            var err = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"GitHub PR creation failed ({(int)res.StatusCode}): {err}");
        }

        var doc = await res.Content.ReadFromJsonAsync<JsonElement>(ct);
        return doc.GetProperty("html_url").GetString();
    }
}