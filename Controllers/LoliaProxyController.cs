using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Primitives;
using MSLX.SDK.Models;
using Newtonsoft.Json.Linq;

namespace MSLX.Plugin.Lolia.Frp.Controllers;

[ApiController]
[Route("api/plugins/mslx-plugin-lolia-frp")]
public class LoliaProxyController : ControllerBase
{
    private const string LoliaApiBaseUrl = "https://api.lolia.link/api/v1";
    private static readonly HttpClient HttpClient = new HttpClient();

    [HttpGet("proxy/{*path}")]
    public Task<IActionResult> ProxyGet(string path) => ForwardRequestAsync(HttpMethod.Get, path);

    [HttpPost("proxy/{*path}")]
    public Task<IActionResult> ProxyPost(string path) => ForwardRequestAsync(HttpMethod.Post, path);

    [HttpDelete("proxy/{*path}")]
    public Task<IActionResult> ProxyDelete(string path) => ForwardRequestAsync(HttpMethod.Delete, path);

    [HttpPut("proxy/{*path}")]
    public Task<IActionResult> ProxyPut(string path) => ForwardRequestAsync(HttpMethod.Put, path);

    private async Task<IActionResult> ForwardRequestAsync(HttpMethod method, string path)
    {
        try
        {
            var targetUrl = $"{LoliaApiBaseUrl}/{path.TrimStart('/')}{Request.QueryString}";
            using var requestMessage = new HttpRequestMessage(method, targetUrl);

            // Forward Authorization and other relevant headers
            if (Request.Headers.TryGetValue("Authorization", out StringValues authVal) && !StringValues.IsNullOrEmpty(authVal))
            {
                requestMessage.Headers.TryAddWithoutValidation("Authorization", authVal.ToString());
            }

            if (Request.Headers.TryGetValue("X-Lolia-Authorization", out StringValues xAuthVal) && !StringValues.IsNullOrEmpty(xAuthVal))
            {
                requestMessage.Headers.TryAddWithoutValidation("Authorization", xAuthVal.ToString());
            }

            if (method == HttpMethod.Post || method == HttpMethod.Put)
            {
                using var reader = new StreamReader(Request.Body);
                var rawBody = await reader.ReadToEndAsync();
                requestMessage.Content = new StringContent(rawBody, Encoding.UTF8, "application/json");
            }

            using var response = await HttpClient.SendAsync(requestMessage);
            var responseContent = await response.Content.ReadAsStringAsync();

            var statusCode = (int)response.StatusCode;
            var contentType = response.Content.Headers.ContentType?.MediaType ?? "application/json";

            return Content(responseContent, contentType, Encoding.UTF8);
        }
        catch (Exception ex)
        {
            return StatusCode(500, new ApiResponse<object?>
            {
                Code = 500,
                Message = $"代理请求异常: {ex.Message}",
                Data = null
            });
        }
    }
}
