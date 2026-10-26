using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Primitives;
using MSLX.SDK.Models;

namespace MSLX.Plugin.Lolia.Frp.Controllers;

[ApiController]
[Route("api/plugin/mslx-plugin-lolia-frp")]
public class LoliaProxyController : ControllerBase
{
    private const string LoliaApiBaseUrl = "https://api.lolia.link/api/v1";
    private static readonly HttpClient HttpClient = new HttpClient();

    /// <summary>
    /// OAuth2 令牌交换与刷新
    /// </summary>
    [HttpPost("oauth2/token")]
    public Task<IActionResult> ExchangeOrRefreshToken() => ForwardRequestAsync(HttpMethod.Post, "oauth2/token");

    /// <summary>
    /// 获取当前登录用户信息
    /// </summary>
    [HttpGet("user/info")]
    public Task<IActionResult> GetUserInfo() => ForwardRequestAsync(HttpMethod.Get, "user/info");

    /// <summary>
    /// 获取用户的穿透隧道列表
    /// </summary>
    [HttpGet("user/tunnel")]
    public Task<IActionResult> GetTunnels() => ForwardRequestAsync(HttpMethod.Get, "user/tunnel");

    /// <summary>
    /// 创建新穿透隧道
    /// </summary>
    [HttpPost("user/tunnel")]
    public Task<IActionResult> CreateTunnel() => ForwardRequestAsync(HttpMethod.Post, "user/tunnel");

    /// <summary>
    /// 删除指定穿透隧道
    /// </summary>
    [HttpDelete("user/tunnel/{tunnelName}")]
    public Task<IActionResult> DeleteTunnel(string tunnelName) =>
        ForwardRequestAsync(HttpMethod.Delete, $"user/tunnel/{Uri.EscapeDataString(tunnelName)}");

    /// <summary>
    /// 获取穿透可用节点列表
    /// </summary>
    [HttpPost("user/nodes")]
    public Task<IActionResult> GetNodes() => ForwardRequestAsync(HttpMethod.Post, "user/nodes");

    /// <summary>
    /// 获取指定隧道的 FRPC 配置文件内容
    /// </summary>
    [HttpGet("user/frpc/config")]
    public Task<IActionResult> GetFrpcConfig() => ForwardRequestAsync(HttpMethod.Get, "user/frpc/config");

    private async Task<IActionResult> ForwardRequestAsync(HttpMethod method, string relativePath)
    {
        try
        {
            var targetUrl = $"{LoliaApiBaseUrl}/{relativePath.TrimStart('/')}{Request.QueryString}";
            using var requestMessage = new HttpRequestMessage(method, targetUrl);

            // 注入标准 User-Agent 防止被 WAF 误杀
            requestMessage.Headers.TryAddWithoutValidation("User-Agent", "MSLX-Plugin-Lolia-Frp/1.0.5");

            // 优先转接 X-Lolia-Authorization，兼容标准 Authorization
            if (Request.Headers.TryGetValue("X-Lolia-Authorization", out StringValues xAuthVal) && !StringValues.IsNullOrEmpty(xAuthVal))
            {
                requestMessage.Headers.TryAddWithoutValidation("Authorization", xAuthVal.ToString());
            }
            else if (Request.Headers.TryGetValue("Authorization", out StringValues authVal) && !StringValues.IsNullOrEmpty(authVal))
            {
                requestMessage.Headers.TryAddWithoutValidation("Authorization", authVal.ToString());
            }

            if (method == HttpMethod.Post || method == HttpMethod.Put || method == HttpMethod.Delete)
            {
                using var reader = new StreamReader(Request.Body);
                var rawBody = await reader.ReadToEndAsync();
                if (!string.IsNullOrWhiteSpace(rawBody))
                {
                    requestMessage.Content = new StringContent(rawBody, Encoding.UTF8, "application/json");
                }
            }

            using var response = await HttpClient.SendAsync(requestMessage);
            var responseContent = await response.Content.ReadAsStringAsync();

            var contentType = response.Content.Headers.ContentType?.MediaType ?? "application/json";

            return new ContentResult
            {
                Content = responseContent,
                ContentType = contentType,
                StatusCode = (int)response.StatusCode
            };
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
