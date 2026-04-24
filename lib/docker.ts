import Docker from "dockerode";

function createDockerClient() {
  const dockerHost = process.env.DOCKER_HOST?.trim();
  const dockerPort = process.env.DOCKER_PORT?.trim();

  if (dockerHost) {
    if (dockerHost.startsWith("unix://")) {
      return new Docker({
        socketPath: dockerHost.replace("unix://", ""),
      });
    }

    if (dockerHost.startsWith("tcp://") || dockerHost.startsWith("http://") || dockerHost.startsWith("https://")) {
      const normalizedUrl = dockerHost.replace(/^tcp:\/\//, "http://");
      const url = new URL(normalizedUrl);
      return new Docker({
        protocol: url.protocol.replace(":", "") as "http" | "https",
        host: url.hostname,
        port: Number(url.port || (url.protocol === "https:" ? 443 : 2375)),
      });
    }
  }

  if (process.platform === "win32") {
    return new Docker({
      host: process.env.DOCKER_TCP_HOST?.trim() || "localhost",
      port: Number(dockerPort || process.env.DOCKER_TCP_PORT || 2375),
    });
  }

  return new Docker({
    socketPath: process.env.DOCKER_SOCKET_PATH?.trim() || "/var/run/docker.sock",
  });
}

export const docker = createDockerClient();
