using Microsoft.EntityFrameworkCore;

// ColumnId is only used on create (null = first column); moving between columns goes through /move.
public record TaskInput(string Title, string? Description, string? AssigneeUserId, Guid? AssigneeAgentId, Guid? ColumnId = null);
public record MoveTask(Guid ColumnId, int Position);

public static class TaskEndpoints
{
    public static void MapTaskEndpoints(this IEndpointRouteBuilder proj)
    {
        var g = proj.MapGroup("/tasks").WithTags("Tasks");

        g.MapGet("/", async (Guid projectId, AppDb db) =>
            await db.Tasks.Where(t => t.ProjectId == projectId)
                .OrderBy(t => t.Position).ToListAsync());

        g.MapPost("/", async (Guid projectId, TaskInput req, AppDb db) =>
        {
            if (await Validate(projectId, req, db) is { } error) return error;

            var columns = await ColumnEndpoints.EnsureColumns(db, projectId);
            var column = req.ColumnId is { } cid ? columns.FirstOrDefault(c => c.Id == cid) : columns[0];
            if (column is null) return Results.BadRequest("Column not found in this project");

            var maxPos = await db.Tasks.Where(t => t.ColumnId == column.Id)
                .MaxAsync(t => (int?)t.Position) ?? 0;
            var t = new TaskItem
            {
                ProjectId = projectId,
                Title = req.Title,
                Description = req.Description,
                AssigneeUserId = req.AssigneeUserId,
                AssigneeAgentId = req.AssigneeAgentId,
                ColumnId = column.Id,
                Position = maxPos + 1
            };
            db.Tasks.Add(t);
            await db.SaveChangesAsync();
            return Results.Created($"/api/projects/{projectId}/tasks/{t.Id}", t);
        });

        g.MapPut("/{id:guid}", async (Guid projectId, Guid id, TaskInput req, AppDb db) =>
        {
            var t = await db.Tasks.FirstOrDefaultAsync(x => x.Id == id && x.ProjectId == projectId);
            if (t is null) return Results.NotFound();
            if (await Validate(projectId, req, db) is { } error) return error;
            t.Title = req.Title; t.Description = req.Description;
            t.AssigneeUserId = req.AssigneeUserId; t.AssigneeAgentId = req.AssigneeAgentId;
            await db.SaveChangesAsync();
            return Results.Ok(t);
        });

        g.MapPatch("/{id:guid}/move", async (Guid projectId, Guid id, MoveTask req, AppDb db) =>
        {
            var t = await db.Tasks.FirstOrDefaultAsync(x => x.Id == id && x.ProjectId == projectId);
            if (t is null) return Results.NotFound();
            if (!await db.Columns.AnyAsync(c => c.Id == req.ColumnId && c.ProjectId == projectId))
                return Results.BadRequest("Column not found in this project");
            t.ColumnId = req.ColumnId; t.Position = req.Position;
            await db.SaveChangesAsync();
            return Results.Ok(t);
        });

        g.MapDelete("/{id:guid}", async (Guid projectId, Guid id, AppDb db) =>
        {
            var n = await db.Tasks.Where(x => x.Id == id && x.ProjectId == projectId).ExecuteDeleteAsync();
            return n == 0 ? Results.NotFound() : Results.NoContent();
        });
    }

    // Assignee must be a member of this project / an agent of this project
    static async Task<IResult?> Validate(Guid projectId, TaskInput req, AppDb db)
    {
        if (string.IsNullOrWhiteSpace(req.Title)) return Results.BadRequest("Title is required");
        if (req.AssigneeUserId is not null && req.AssigneeAgentId is not null)
            return Results.BadRequest("Assign to a human OR an agent, not both");
        if (req.AssigneeUserId is not null &&
            !await db.Members.AnyAsync(m => m.ProjectId == projectId && m.UserId == req.AssigneeUserId))
            return Results.BadRequest("Assignee is not a project member");
        if (req.AssigneeAgentId is not null &&
            !await db.Agents.AnyAsync(a => a.ProjectId == projectId && a.Id == req.AssigneeAgentId))
            return Results.BadRequest("Agent not found in this project");
        return null;
    }
}