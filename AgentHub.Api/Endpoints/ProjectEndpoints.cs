using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

public record CreateProject(string Name, string? Description, string? GitHubUrl);
public record InviteRequest(string Email);

public static class ProjectEndpoints
{
    public static void MapProjectEndpoints(this IEndpointRouteBuilder app)
    {
        var root = app.MapGroup("/api/projects").RequireAuthorization().WithTags("Projects");

        root.MapGet("/", async (AppDb db, ClaimsPrincipal u) =>
        {
            var uid = u.UserId();
            return await db.Projects
                .Where(p => p.Members.Any(m => m.UserId == uid))
                .OrderByDescending(p => p.CreatedAt)
                .Select(p => new { p.Id, p.Name, p.Description, p.GitHubUrl })
                .ToListAsync();
        });

        root.MapPost("/", async (CreateProject req, AppDb db, ClaimsPrincipal u) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name)) return Results.BadRequest("Name is required");
            var p = new Project { Name = req.Name, Description = req.Description, GitHubUrl = req.GitHubUrl };
            p.Members.Add(new ProjectMember { UserId = u.UserId(), Role = ProjectRole.Owner });
            db.Projects.Add(p);
            await db.SaveChangesAsync();
            return Results.Created($"/api/projects/{p.Id}", new { p.Id });
        });

        // Everything below requires membership
        var proj = root.MapGroup("/{projectId:guid}").AddEndpointFilter<MemberFilter>();

        proj.MapGet("/", async (Guid projectId, AppDb db) =>
            await db.Projects.Where(p => p.Id == projectId)
                .Select(p => new { p.Id, p.Name, p.Description, p.GitHubUrl }).FirstAsync());

        proj.MapPut("/", async (Guid projectId, CreateProject req, AppDb db) =>
        {
            var p = await db.Projects.FindAsync(projectId);
            p!.Name = req.Name; p.Description = req.Description; p.GitHubUrl = req.GitHubUrl;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        proj.MapDelete("/", async (Guid projectId, AppDb db, ClaimsPrincipal u) =>
        {
            var uid = u.UserId();
            var isOwner = await db.Members.AnyAsync(m => m.ProjectId == projectId && m.UserId == uid && m.Role == ProjectRole.Owner);
            if (!isOwner) return Results.Forbid();
            await db.Projects.Where(p => p.Id == projectId).ExecuteDeleteAsync();
            return Results.NoContent();
        });

        proj.MapGet("/members", async (Guid projectId, AppDb db) =>
            await db.Members.Where(m => m.ProjectId == projectId)
                .Select(m => new { m.UserId, m.User.Email, m.Role }).ToListAsync());

        // Invite = add an already-registered user by email (no email sending for now)
        proj.MapPost("/members", async (Guid projectId, InviteRequest req, AppDb db) =>
        {
            var user = await db.Users.FirstOrDefaultAsync(x => x.NormalizedEmail == req.Email.ToUpperInvariant());
            if (user is null) return Results.NotFound("User must register first");
            if (await db.Members.AnyAsync(m => m.ProjectId == projectId && m.UserId == user.Id))
                return Results.Conflict("Already a member");
            db.Members.Add(new ProjectMember { ProjectId = projectId, UserId = user.Id, Role = ProjectRole.Member });
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Feature modules plug into the same protected group
        proj.MapTaskEndpoints();
        proj.MapAgentEndpoints();
    }
}