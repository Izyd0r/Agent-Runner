using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Authorization;
using Microsoft.OpenApi;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<AppDb>(o => o.UseSqlite("Data Source=app.db"));
builder.Services.AddAuthorization();
builder.Services.AddIdentityApiEndpoints<AppUser>()
    .AddEntityFrameworkStores<AppDb>();
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, ctx, ct) =>
    {
        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();
        document.Components.SecuritySchemes["Bearer"] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT"
        };
        return Task.CompletedTask;
    });

    options.AddOperationTransformer((operation, ctx, ct) =>
    {
        if (ctx.Description.ActionDescriptor.EndpointMetadata.OfType<IAuthorizeData>().Any())
        {
            operation.Security ??= [];
            operation.Security.Add(new OpenApiSecurityRequirement
            {
                [new OpenApiSecuritySchemeReference("Bearer", ctx.Document)] = []
            });
        }
        return Task.CompletedTask;
    });
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<AppDb>().Database.EnsureCreated();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference(); // UI at /scalar
}

app.UseAuthentication();
app.UseAuthorization();

app.MapGroup("/api/auth").MapIdentityApi<AppUser>();

app.MapGet("/api/me", (ClaimsPrincipal user) => new
{
    Id = user.FindFirstValue(ClaimTypes.NameIdentifier),
    Email = user.FindFirstValue(ClaimTypes.Email)
}).RequireAuthorization();

app.Run();

public class AppUser : IdentityUser { public string? DisplayName { get; set; } }
public class AppDb(DbContextOptions<AppDb> options) : IdentityDbContext<AppUser>(options);