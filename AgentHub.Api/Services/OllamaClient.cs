using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AgentHub.Api.Services;

public sealed class OllamaOptions
{
    public string BaseUrl { get; set; } = "http://localhost:11434";
}

public sealed record OllamaModelDto(string Name, long SizeBytes, string? ParameterSize, string? Quantization);

/// One message in the conversation. Role: system | user | assistant | tool
public record ChatMessage(
    string Role,
    string Content = "",
    [property: JsonPropertyName("tool_calls")] List<ToolCall>? ToolCalls = null,
    [property: JsonPropertyName("tool_name")] string? ToolName = null);

public record ToolCall(ToolFn Function);

public record ToolFn(string Name, JsonElement Arguments);

public record ChatResult(ChatMessage Message, int PromptTokens, int OutputTokens);

public sealed class OllamaClient(HttpClient http)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    /// Sends the whole conversation to Ollama and returns the model's next message
    /// (either plain text, or tool_calls the caller must execute).
    public async Task<ChatResult> ChatAsync(
        string model, double temperature, List<ChatMessage> messages,
        object[] tools, CancellationToken ct = default)
    {
        var body = new
        {
            model,
            messages,
            tools,
            stream = false,
            keep_alive = "30m",
            options = new { temperature, num_ctx = 16384 }
        };

        using var res = await http.PostAsJsonAsync("/api/chat", body, Json, ct);
        if (!res.IsSuccessStatusCode)
        {
            var err = await res.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Ollama returned {(int)res.StatusCode}: {err}");
        }

        var doc = await res.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
        var msg = doc.GetProperty("message").Deserialize<ChatMessage>(Json)
                  ?? throw new InvalidOperationException("Ollama returned an empty message.");
        var prompt = doc.TryGetProperty("prompt_eval_count", out var p) ? p.GetInt32() : 0;
        var output = doc.TryGetProperty("eval_count", out var e) ? e.GetInt32() : 0;
        return new ChatResult(msg, prompt, output);
    }

    public async Task<List<OllamaModelDto>> ListModelsAsync(CancellationToken ct = default)
    {
        using var res = await http.GetAsync("/api/tags", ct);
        res.EnsureSuccessStatusCode();

        var doc = await res.Content.ReadFromJsonAsync<JsonElement>(Json, ct);
        var models = new List<OllamaModelDto>();

        if (doc.TryGetProperty("models", out var arr))
        {
            foreach (var item in arr.EnumerateArray())
            {
                var name = item.GetProperty("name").GetString() ?? "";
                var size = item.TryGetProperty("size", out var s) ? s.GetInt64() : 0L;
                string? paramSize = null;
                string? quant = null;

                if (item.TryGetProperty("details", out var details))
                {
                    if (details.TryGetProperty("parameter_size", out var ps)) paramSize = ps.GetString();
                    if (details.TryGetProperty("quantization_level", out var ql)) quant = ql.GetString();
                }

                models.Add(new OllamaModelDto(name, size, paramSize, quant));
            }
        }

        return models.OrderBy(m => m.Name).ToList();
    }
}