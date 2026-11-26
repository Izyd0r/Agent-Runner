using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

public class AppDb(DbContextOptions<AppDb> options) : IdentityDbContext<AppUser>(options)
{
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectMember> Members => Set<ProjectMember>();
    public DbSet<Agent> Agents => Set<Agent>();
    public DbSet<TaskItem> Tasks => Set<TaskItem>();
    public DbSet<BoardColumn> Columns => Set<BoardColumn>();
    public DbSet<AgentRun> Runs => Set<AgentRun>();
    public DbSet<AgentRunLog> RunLogs => Set<AgentRunLog>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<ProjectMember>().HasKey(m => new { m.ProjectId, m.UserId });
        b.Entity<Project>().HasMany(p => p.Members).WithOne().HasForeignKey(m => m.ProjectId);

        b.Entity<Agent>().HasOne<Project>().WithMany().HasForeignKey(a => a.ProjectId);
        b.Entity<TaskItem>().HasOne<Project>().WithMany().HasForeignKey(t => t.ProjectId);

        b.Entity<BoardColumn>().HasOne<Project>().WithMany().HasForeignKey(c => c.ProjectId);
        b.Entity<BoardColumn>().HasIndex(c => new { c.ProjectId, c.Position });
        b.Entity<TaskItem>().HasOne<BoardColumn>().WithMany()
            .HasForeignKey(t => t.ColumnId).OnDelete(DeleteBehavior.NoAction);
        b.Entity<TaskItem>().HasOne<Agent>().WithMany()
            .HasForeignKey(t => t.AssigneeAgentId).OnDelete(DeleteBehavior.SetNull);

        b.Entity<AgentRun>().HasOne<TaskItem>().WithMany().HasForeignKey(r => r.TaskId);
        b.Entity<AgentRun>().HasOne<Agent>().WithMany().HasForeignKey(r => r.AgentId);
        b.Entity<AgentRunLog>().HasOne<AgentRun>().WithMany().HasForeignKey(l => l.RunId);
        b.Entity<AgentRunLog>().HasIndex(l => new { l.RunId, l.Id });
    }

    protected override void ConfigureConventions(ModelConfigurationBuilder c)
        => c.Properties<Enum>().HaveConversion<string>();
}