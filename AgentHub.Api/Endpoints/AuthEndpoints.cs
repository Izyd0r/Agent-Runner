using System.Security.Claims;
using Microsoft.AspNetCore.Identity;

public record RegisterRequest(
    string Email,
    string Password,
    string DisplayName,
    string? GitHubUsername,
    string? RoleTitle);

public record UpdateProfileRequest(string DisplayName, string? GitHubUsername, string? RoleTitle);
public record ChangeEmailRequest(string NewEmail, string CurrentPassword);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);
public record ForgotPasswordRequest(string Email);
public record ResetPasswordRequest(string Email, string ResetCode, string NewPassword);

public static class AuthEndpoints
{
    public static void MapCustomAuthEndpoints(this IEndpointRouteBuilder app)
    {
        var auth = app.MapGroup("/api/auth").WithTags("Auth");

        auth.MapPost("/signup", async (RegisterRequest req, UserManager<AppUser> userManager) =>
        {
            if (string.IsNullOrWhiteSpace(req.Email) || string.IsNullOrWhiteSpace(req.Password))
                return Results.BadRequest("Email and password are required.");
            if (string.IsNullOrWhiteSpace(req.DisplayName))
                return Results.BadRequest("Display name is required.");

            var email = req.Email.Trim();
            var user = new AppUser
            {
                UserName = email,
                Email = email,
                DisplayName = req.DisplayName.Trim(),
                GitHubUsername = string.IsNullOrWhiteSpace(req.GitHubUsername)
                    ? null
                    : req.GitHubUsername.Trim().TrimStart('@'),
                RoleTitle = string.IsNullOrWhiteSpace(req.RoleTitle) ? null : req.RoleTitle.Trim(),
            };

            var result = await userManager.CreateAsync(user, req.Password);
            if (!result.Succeeded)
                return Results.BadRequest(string.Join(" ", result.Errors.Select(e => e.Description)));

            return Results.Ok(new { user.Id, user.Email, user.DisplayName });
        });

        auth.MapIdentityApi<AppUser>();

        var me = app.MapGroup("/api/me").RequireAuthorization().WithTags("Auth");

        me.MapGet("/", async (ClaimsPrincipal principal, UserManager<AppUser> userManager) =>
        {
            var user = await userManager.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();

            return Results.Ok(ToMeDto(user));
        });

        me.MapPut("/", async (
            UpdateProfileRequest req,
            ClaimsPrincipal principal,
            UserManager<AppUser> userManager) =>
        {
            if (string.IsNullOrWhiteSpace(req.DisplayName))
                return Results.BadRequest("Display name is required.");

            var user = await userManager.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();

            user.DisplayName = req.DisplayName.Trim();
            user.GitHubUsername = string.IsNullOrWhiteSpace(req.GitHubUsername)
                ? null
                : req.GitHubUsername.Trim().TrimStart('@');
            user.RoleTitle = string.IsNullOrWhiteSpace(req.RoleTitle) ? null : req.RoleTitle.Trim();

            var result = await userManager.UpdateAsync(user);
            if (!result.Succeeded)
                return Results.BadRequest(string.Join(" ", result.Errors.Select(e => e.Description)));

            return Results.Ok(ToMeDto(user));
        });

        me.MapPost("/email", async (
            ChangeEmailRequest req,
            ClaimsPrincipal principal,
            UserManager<AppUser> userManager) =>
        {
            var newEmail = req.NewEmail?.Trim();
            if (string.IsNullOrWhiteSpace(newEmail) || string.IsNullOrWhiteSpace(req.CurrentPassword))
                return Results.BadRequest("New email and current password are required.");

            var user = await userManager.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();

            if (!await userManager.CheckPasswordAsync(user, req.CurrentPassword))
                return Results.BadRequest("Current password is incorrect.");

            if (string.Equals(user.Email, newEmail, StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest("New email must be different from your current email.");

            var existing = await userManager.FindByEmailAsync(newEmail);
            if (existing is not null && existing.Id != user.Id)
                return Results.Conflict("That email address is already in use.");

            var emailRes = await userManager.SetEmailAsync(user, newEmail);
            if (!emailRes.Succeeded)
                return Results.BadRequest(string.Join(" ", emailRes.Errors.Select(e => e.Description)));

            var userNameRes = await userManager.SetUserNameAsync(user, newEmail);
            if (!userNameRes.Succeeded)
                return Results.BadRequest(string.Join(" ", userNameRes.Errors.Select(e => e.Description)));

            return Results.Ok(ToMeDto(user));
        });

        me.MapPost("/password", async (
            ChangePasswordRequest req,
            ClaimsPrincipal principal,
            UserManager<AppUser> userManager) =>
        {
            if (string.IsNullOrWhiteSpace(req.CurrentPassword) || string.IsNullOrWhiteSpace(req.NewPassword))
                return Results.BadRequest("Current and new passwords are required.");

            var user = await userManager.GetUserAsync(principal);
            if (user is null) return Results.Unauthorized();

            var result = await userManager.ChangePasswordAsync(user, req.CurrentPassword, req.NewPassword);
            if (!result.Succeeded)
                return Results.BadRequest(string.Join(" ", result.Errors.Select(e => e.Description)));

            return Results.NoContent();
        });

        auth.MapPost("/forgot-password", async (
            ForgotPasswordRequest req,
            UserManager<AppUser> userManager,
            IEmailSender<AppUser> emailSender) =>
        {
            var email = req.Email?.Trim();
            if (string.IsNullOrWhiteSpace(email))
                return Results.BadRequest("Email is required.");

            var user = await userManager.FindByEmailAsync(email);
            if (user is not null)
            {
                var code = await userManager.GeneratePasswordResetTokenAsync(user);
                await emailSender.SendPasswordResetCodeAsync(user, user.Email!, code);
            }

            // Always return 200 OK so callers cannot enumerate registered emails
            return Results.Ok();
        });

        auth.MapPost("/reset-password", async (
            ResetPasswordRequest req,
            UserManager<AppUser> userManager) =>
        {
            var email = req.Email?.Trim();
            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(req.ResetCode) || string.IsNullOrWhiteSpace(req.NewPassword))
                return Results.BadRequest("Email, reset code, and new password are required.");

            var user = await userManager.FindByEmailAsync(email);
            if (user is null)
                return Results.BadRequest("Invalid reset token.");

            var result = await userManager.ResetPasswordAsync(user, req.ResetCode, req.NewPassword);
            if (!result.Succeeded)
                return Results.BadRequest(string.Join(" ", result.Errors.Select(e => e.Description)));

            return Results.Ok();
        });
    }

    private static object ToMeDto(AppUser user) => new
    {
        user.Id,
        user.Email,
        user.DisplayName,
        user.GitHubUsername,
        user.RoleTitle,
    };
}