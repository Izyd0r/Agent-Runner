using System.Net.Mail;
using Microsoft.AspNetCore.Identity;

namespace AgentHub.Api.Services;

public sealed class SmtpEmailSender(IConfiguration config, ILogger<SmtpEmailSender> log)
    : IEmailSender<AppUser>
{
    public Task SendPasswordResetCodeAsync(AppUser user, string email, string resetCode)
    {
        var frontendUrl = (config["FrontendUrl"] ?? "http://localhost:5173").TrimEnd('/');
        var resetLink = $"{frontendUrl}/auth?mode=reset&email={Uri.EscapeDataString(email)}&code={Uri.EscapeDataString(resetCode)}";

        var html = $"""
            <p>Hello {System.Net.WebUtility.HtmlEncode(user.DisplayName ?? email)},</p>
            <p>Click the button below to reset your AgentHub password:</p>
            <p><a href="{resetLink}" style="display:inline-block;padding:10px 18px;background:#12b886;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Reset password</a></p>
            <p style="font-size:12px;color:#666;">Or copy this link:<br/>{resetLink}</p>
            """;

        return SendAsync(email, "Reset your AgentHub password", html, isHtml: true);
    }

    public Task SendPasswordResetLinkAsync(AppUser user, string email, string resetLink) =>
        SendAsync(email, "Reset your AgentHub password", $"<p><a href=\"{resetLink}\">Reset your password</a></p>", isHtml: true);

    public Task SendConfirmationLinkAsync(AppUser user, string email, string confirmationLink) =>
        SendAsync(email, "Confirm your AgentHub email", $"<p><a href=\"{confirmationLink}\">Confirm your email</a></p>", isHtml: true);

    private async Task SendAsync(string to, string subject, string body, bool isHtml = false)
    {
        var host = config["Smtp:Host"] ?? "localhost";
        var port = int.TryParse(config["Smtp:Port"], out var p) ? p : 1025;
        var from = config["Smtp:From"] ?? "noreply@agenthub.local";

        using var client = new SmtpClient(host, port);
        using var message = new MailMessage(from, to, subject, body) { IsBodyHtml = isHtml };
        await client.SendMailAsync(message);
        log.LogInformation("Sent email '{Subject}' to {To} via {Host}:{Port}", subject, to, host, port);
    }
}