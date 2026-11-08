import { FolderOpen } from "lucide-react";
import { AgentCursor } from "../components/arc/agent-cursor/agent-cursor";
import { memoBlocks, memoEdits } from "./filed-under-demo-data";
import styles from "./filed-under-agent-sections.module.css";

/** The agent as it appears in the document: its name, a folder mark and the cursor color. */
const AGENT = { name: "FiledUnder", mark: <FolderOpen size={24} strokeWidth={1.75} aria-hidden="true" />, color: "#2f5bd3" };

function Section({ id, title, body, children, flip = false }: { id: string; title: string; body: string; children: React.ReactNode; flip?: boolean }) {
  return <section className={styles.section} data-flip={flip} aria-labelledby={`${id}-title`}>
    <div className={styles.copy}>
      <h2 id={`${id}-title`} className={styles.title}>{title}</h2>
      <p className={styles.body}>{body}</p>
    </div>
    <div className={styles.demo}>{children}</div>
  </section>;
}

/** Animated memo section for the FiledUnder landing page: a live Arc agent cursor drafting a real earnings recap. */
export function FiledUnderAgentSections() {
  return <div className={styles.stack}>
    <Section id="memo" title="Watch it write the memo"
      body="FiledUnder drafts the recap the way an analyst would. It pulls the numbers behind each claim, tightens the prose and leaves every change tinted until you accept it.">
      <AgentCursor blocks={memoBlocks} meta="Draft for the coverage team, Oct 14" edits={memoEdits} agent={AGENT} collaborator={{ name: "Analyst" }} autoPlay loop />
    </Section>
  </div>;
}

export default FiledUnderAgentSections;
