using System.Security.Claims;
using Microsoft.EntityFrameworkCore;

public static class Common
{
    public static string UserId(this ClaimsPrincipal u) => u.FindFirstValue(ClaimTypes.NameIdentifier)!;
}

public class MemberFilter(AppDb db) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext ctx, EndpointFilterDelegate next)
    {
        var http = ctx.HttpContext;
        var projectId = Guid.Parse((string)http.GetRouteValue("projectId")!);
        var userId = http.User.UserId();

        var isMember = await db.Members.AnyAsync(m => m.ProjectId == projectId && m.UserId == userId);
        return isMember ? await next(ctx) : Results.NotFound();
    }
}