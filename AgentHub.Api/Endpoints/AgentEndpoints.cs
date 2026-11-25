using AgentHub.Api.Services;
using Microsoft.EntityFrameworkCore;

public record AgentInput(string Name, string Model, string SystemPrompt, double Temperature);

public static class AgentEndpoints
{
    public static void MapAgentEndpoints(this IEndpointRouteBuilder proj)
    {
        var g = proj.MapGroup("/agents").WithTags("Agents");

        g.MapGet("/", async (Guid projectId, AppDb db) =>
            await db.Agents.Where(a => a.ProjectId == projectId).ToListAsync());

        g.MapPost("/", async (Guid projectId, AgentInput req, AppDb db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name) || string.IsNullOrWhiteSpace(req.Model))
                return Results.BadRequest("Name and Model are required.");
            var a = new Agent
            {
                ProjectId = projectId,
                Name = req.Name,
                Model = req.Model,
                SystemPrompt = req.SystemPrompt,
                Temperature = req.Temperature
            };
            db.Agents.Add(a);
            await db.SaveChangesAsync();
            return Results.Created($"/api/projects/{projectId}/agents/{a.Id}", a);
        });

        g.MapPut("/{id:guid}", async (Guid projectId, Guid id, AgentInput req, AppDb db) =>
        {
            if (string.IsNullOrWhiteSpace(req.Name) || string.IsNullOrWhiteSpace(req.Model))
                return Results.BadRequest("Name and Model are required.");
            var a = await db.Agents.FirstOrDefaultAsync(x => x.Id == id && x.ProjectId == projectId);
            if (a is null) return Results.NotFound();
            a.Name = req.Name; a.Model = req.Model; a.SystemPrompt = req.SystemPrompt; a.Temperature = req.Temperature;
            await db.SaveChangesAsync();
            return Results.Ok(a);
        });

        g.MapDelete("/{id:guid}", async (Guid projectId, Guid id, AppDb db) =>
        {
            var n = await db.Agents.Where(x => x.Id == id && x.ProjectId == projectId).ExecuteDeleteAsync();
            return n == 0 ? Results.NotFound() : Results.NoContent();
        });

        // All runs for a specific agent across the project, newest first
        g.MapGet("/{id:guid}/runs", async (Guid projectId, Guid id, AppDb db) =>
        {
            var exists = await db.Agents.AnyAsync(a => a.Id == id && a.ProjectId == projectId);
            if (!exists) return Results.NotFound();

            var runs = await (
                from r in db.Runs
                join t in db.Tasks on r.TaskId equals t.Id
                where r.AgentId == id && t.ProjectId == projectId
                orderby r.StartedAt descending
                select new
                {
                    r.Id,
                    r.TaskId,
                    TaskTitle = t.Title,
                    r.AgentId,
                    r.Status,
                    r.StartedAt,
                    r.FinishedAt,
                    r.Branch,
                    r.PullRequestUrl,
                    LogCount = db.RunLogs.Count(l => l.RunId == r.Id)
                }
            ).ToListAsync();

            return Results.Ok(runs);
        });

        g.MapGet("/models", async (OllamaClient ollama, CancellationToken ct) =>
        {
            try
            {
                var models = await ollama.ListModelsAsync(ct);
                return Results.Ok(new { available = true, models });
            }
            catch (Exception ex)
            {
                return Results.Ok(new { available = false, error = ex.Message, models = Array.Empty<OllamaModelDto>() });
            }
        });
    }
}