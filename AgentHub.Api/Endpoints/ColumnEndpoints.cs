using Microsoft.EntityFrameworkCore;

public record ColumnDto(Guid Id, string Name, string Color, int Position, bool IsReviewTarget);
public record ColumnCreate(string Name, string? Color);
public record ColumnUpdate(string Name, string Color, bool IsReviewTarget);

public static class ColumnEndpoints
{
    static readonly HashSet<string> Colors =
        ["gray", "blue", "yellow", "teal", "violet", "red", "orange", "pink"]; // keep in sync with COLUMN_COLORS in types.ts

    static ColumnDto ToDto(BoardColumn c) => new(c.Id, c.Name, c.Color, c.Position, c.IsReviewTarget);

    /// Returns the project's columns ordered by Position, creating the default four if it has none
    /// (e.g. a project created after the migration). Never returns an empty list.
    public static async Task<List<BoardColumn>> EnsureColumns(AppDb db, Guid projectId)
    {
        var cols = await db.Columns.Where(c => c.ProjectId == projectId)
            .OrderBy(c => c.Position).ToListAsync();
        if (cols.Count > 0) return cols;

        cols = BoardColumn.Defaults(projectId);
        db.Columns.AddRange(cols);
        await db.SaveChangesAsync();
        return cols;
    }

    // Mapped on the project group, exactly like MapTaskEndpoints. Project-membership checks
    // come from that parent group, same as for tasks.
    public static void MapColumnEndpoints(this IEndpointRouteBuilder proj)
    {
        var g = proj.MapGroup("/columns").WithTags("Columns");

        g.MapGet("/", async (Guid projectId, AppDb db) =>
            (await EnsureColumns(db, projectId)).Select(ToDto));

        g.MapPost("/", async (Guid projectId, ColumnCreate req, AppDb db) =>
        {
            var name = req.Name?.Trim();
            if (string.IsNullOrEmpty(name)) return Results.BadRequest("Name is required");
            if (name.Length > 40) return Results.BadRequest("Name is too long (max 40)");
            var color = req.Color ?? "gray";
            if (!Colors.Contains(color)) return Results.BadRequest("Unknown color");

            await EnsureColumns(db, projectId);
            var max = await db.Columns.Where(c => c.ProjectId == projectId)
                .MaxAsync(c => (int?)c.Position) ?? 0;
            var col = new BoardColumn { ProjectId = projectId, Name = name, Color = color, Position = max + 1 };
            db.Columns.Add(col);
            await db.SaveChangesAsync();
            return Results.Created($"/api/projects/{projectId}/columns/{col.Id}", ToDto(col));
        });

        g.MapPut("/{id:guid}", async (Guid projectId, Guid id, ColumnUpdate req, AppDb db) =>
        {
            var col = await db.Columns.FirstOrDefaultAsync(c => c.Id == id && c.ProjectId == projectId);
            if (col is null) return Results.NotFound();

            var name = req.Name?.Trim();
            if (string.IsNullOrEmpty(name)) return Results.BadRequest("Name is required");
            if (name.Length > 40) return Results.BadRequest("Name is too long (max 40)");
            if (!Colors.Contains(req.Color)) return Results.BadRequest("Unknown color");

            if (req.IsReviewTarget)
            {
                // only one review column per project
                await db.Columns
                    .Where(c => c.ProjectId == projectId && c.Id != id && c.IsReviewTarget)
                    .ExecuteUpdateAsync(s => s.SetProperty(c => c.IsReviewTarget, false));
            }
            col.Name = name; col.Color = req.Color; col.IsReviewTarget = req.IsReviewTarget;
            await db.SaveChangesAsync();
            return Results.Ok(ToDto(col));
        });

        // ?moveTo=<columnId> says where this column's tasks go (required if it has any).
        g.MapDelete("/{id:guid}", async (Guid projectId, Guid id, Guid? moveTo, AppDb db) =>
        {
            var col = await db.Columns.FirstOrDefaultAsync(c => c.Id == id && c.ProjectId == projectId);
            if (col is null) return Results.NotFound();

            if (await db.Columns.CountAsync(c => c.ProjectId == projectId) <= 1)
                return Results.BadRequest("A board needs at least one column");

            var tasks = await db.Tasks.Where(t => t.ColumnId == id).OrderBy(t => t.Position).ToListAsync();
            if (tasks.Count > 0)
            {
                if (moveTo is null || moveTo == id)
                    return Results.BadRequest("moveTo is required when the column has tasks");
                if (!await db.Columns.AnyAsync(c => c.Id == moveTo && c.ProjectId == projectId))
                    return Results.BadRequest("moveTo column not found in this project");

                var pos = await db.Tasks.Where(t => t.ColumnId == moveTo)
                    .MaxAsync(t => (int?)t.Position) ?? 0;
                foreach (var t in tasks) { t.ColumnId = moveTo.Value; t.Position = ++pos; }
            }

            // If this was the review column, no column is flagged afterwards (finished agent runs
            // then leave their task where it is) until the user picks a new one.
            db.Columns.Remove(col);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }
}
