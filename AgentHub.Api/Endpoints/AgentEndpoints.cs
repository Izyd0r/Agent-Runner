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
    }
}