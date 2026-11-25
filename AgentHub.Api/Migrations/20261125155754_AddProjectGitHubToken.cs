using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AgentHub.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddProjectGitHubToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EncryptedGitHubToken",
                table: "Projects",
                type: "TEXT",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EncryptedGitHubToken",
                table: "Projects");
        }
    }
}
