import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PageHeader } from "@/components/app/page-header";
import { AgentsPage, type AgentsTab } from "@/components/agents/agents-page";

const search = z.object({
  tab: z.enum(["inbox", "tasks", "monitors", "interests"]).optional(),
  item: z.string().regex(/^[0-9a-f]{16}$/).optional(),
});

export const Route = createFileRoute("/_authenticated/app/agents")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Alerts — Filed Under" },
      {
        name: "description",
        content: "Scheduled research tasks, always-on monitors and an inbox of sourced reports and alerts.",
      },
    ],
  }),
  component: Agents,
});

function Agents() {
  const { tab = "inbox", item } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader
        eyebrow="Agents"
        title="Alerts"
        description="Tasks run on a schedule and deliver sourced reports; monitors watch the data and alert you when something new matches."
      />
      <AgentsPage
        tab={tab as AgentsTab}
        item={item}
        onTab={(t) => navigate({ search: { tab: t } })}
        onItem={(id) => navigate({ search: (s) => ({ ...s, item: id }) })}
      />
    </div>
  );
}
