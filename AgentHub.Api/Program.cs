using System.Security.Claims;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi;
using Scalar.AspNetCore;
using AgentHub.Api.Services;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// ---------- Services ----------
builder.Services.AddDbContext<AppDb>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=App_Data/app.db"));

builder.Services.AddAuthorization();
builder.Services.AddIdentityApiEndpoints<AppUser>()
    .AddEntityFrameworkStores<AppDb>();
builder.Services.Configure<AgentHub.Api.Services.WorkspaceOptions>(
    builder.Configuration.GetSection("Workspaces"));
builder.Services.AddSingleton<AgentHub.Api.Services.WorkspaceService>();
builder.Services.AddSingleton<RunQueue>();
builder.Services.AddHostedService<AgentRunner>();
builder.Services.Configure<OllamaOptions>(builder.Configuration.GetSection("Ollama"));
builder.Services.AddHttpClient<GitHubService>();
builder.Services.AddHttpClient<OllamaClient>((sp, client) =>
{
    client.BaseAddress = new Uri(sp.GetRequiredService<IOptions<OllamaOptions>>().Value.BaseUrl);
    client.Timeout = TimeSpan.FromMinutes(10);   // local inference can be slow
});
builder.Services.AddDataProtection();

// Enums as "Todo" / "InProgress" instead of 0 / 1
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

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

// ---------- Database ----------
Directory.CreateDirectory("App_Data");

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    db.Database.Migrate();                                  // applies pending EF migrations
    db.Database.ExecuteSqlRaw("PRAGMA journal_mode=WAL;");  // concurrent reads while agents write logs
}

// ---------- Pipeline ----------
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference(); // UI at /scalar
}

app.UseAuthentication();
app.UseAuthorization();

// ---------- Endpoints ----------
app.MapGroup("/api/auth").MapIdentityApi<AppUser>().WithTags("Auth");

app.MapGet("/api/me", (ClaimsPrincipal user) => new
{
    Id = user.FindFirstValue(ClaimTypes.NameIdentifier),
    Email = user.FindFirstValue(ClaimTypes.Email)
}).RequireAuthorization().WithTags("Auth");

app.MapProjectEndpoints(); // also maps tasks + agents under /api/projects/{projectId}
app.Run();