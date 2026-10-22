import { Container } from "@cloudflare/containers";

export class PyreWireEngine extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
}
