import Docker from "dockerode";

// export const docker = new Docker({
//   socketPath: "/var/run/docker.sock",
// });

export const docker = new Docker({
  host: "localhost",
  port: 2375,
});