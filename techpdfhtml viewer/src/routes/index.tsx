import { createFileRoute } from "@tanstack/react-router";
import { TeachApp } from "@/components/teach-app";

export const Route = createFileRoute("/")({ component: TeachApp });
