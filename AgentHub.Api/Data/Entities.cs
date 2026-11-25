using Microsoft.AspNetCore.Identity;

public class AppUser : IdentityUser { public string? DisplayName { get; set; } }

public enum ProjectRole { Owner, Member }
public enum TaskItemStatus { Todo, InProgress, Review, Done }
public enum RunStatus { Queued, Running, Succeeded, Failed }

public class Project
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string? GitHubUrl { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public List<ProjectMember> Members { get; set; } = [];
}

public class ProjectMember
{
    public Guid ProjectId { get; set; }
    public string UserId { get; set; } = "";
    public AppUser User { get; set; } = null!;
    public ProjectRole Role { get; set; }
}

public class Agent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjectId { get; set; }
    public string Name { get; set; } = "";
    public string Model { get; set; } = "llama3.1";
    public string SystemPrompt { get; set; } = "";
    public double Temperature { get; set; } = 0.2;
}

public class TaskItem
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjectId { get; set; }
    public string Title { get; set; } = "";
    public string? Description { get; set; }
    public TaskItemStatus Status { get; set; } = TaskItemStatus.Todo;
    public int Position { get; set; }
    public string? AssigneeUserId { get; set; }
    public Guid? AssigneeAgentId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class AgentRun
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid TaskId { get; set; }
    public Guid AgentId { get; set; }
    public RunStatus Status { get; set; } = RunStatus.Queued;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? FinishedAt { get; set; }
    public string? Branch { get; set; }
    public string? PullRequestUrl { get; set; }
}

public class AgentRunLog
{
    public long Id { get; set; }
    public Guid RunId { get; set; }
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string Kind { get; set; } = "info"; // info | tool_call | tool_result | message | error
    public string Message { get; set; } = "";
}