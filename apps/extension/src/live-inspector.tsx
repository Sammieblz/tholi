import React from "react";
import type { SessionView } from "../../../packages/shared-types";
import { hash } from "../../../packages/page-model";

export function LiveInspector({
  view,
  download,
}: {
  view: SessionView;
  download: () => void;
}) {
  const diagnostics = view.liveDiagnostics;
  if (!diagnostics) return null;
  const planning = diagnostics.planning;
  return (
    <>
      <h3>Live observation</h3>
      <p>
        Revision {diagnostics.revision} · {diagnostics.controlCount} controls ·{" "}
        {diagnostics.partial ? "Partial scan" : "Complete scan"}
      </p>
      <p className="small">
        Structure {diagnostics.structure} · state {diagnostics.state}
      </p>
      {planning && (
        <>
          <h3>Goal decision</h3>
          <p>
            {planning.decision} · {planning.source} · planned at revision{" "}
            {planning.revision}
          </p>
          <p className="small">
            Scores rank semantic evidence; they are not measured accuracy.
            Labels below are shown only when the current binding still matches.
          </p>
          <table className="live-targets">
            <caption>Live target candidates</caption>
            <thead>
              <tr>
                <th>Control</th>
                <th>Score</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {planning.candidates.map((c) => {
                const current = view.page?.controls.find(
                  (p) => p.id === c.id && hash(p.signature) === c.signature,
                );
                return (
                  <tr key={c.id} data-diagnostic-control={c.id}>
                    <td>
                      {current?.label || c.signature}
                      <small>
                        {c.role} · {c.kind}
                      </small>
                    </td>
                    <td>{c.score.toFixed(2)}</td>
                    <td>
                      {c.reasons.join(", ") || "No semantic match"}
                      <small>
                        label {c.evidence.label}, description{" "}
                        {c.evidence.description}, context {c.evidence.context}
                      </small>
                      {c.revealIds.length > 0 && (
                        <small>
                          Reveal ownership: {c.revealIds.join(", ")}
                        </small>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {planning.truncated && (
            <p>Showing 50 of {planning.totalCandidates} candidates.</p>
          )}
          {planning.memory && (
            <>
              <h3>Memory evidence</h3>
              <p>
                Site version {planning.memory.version} · page version{" "}
                {planning.memory.pageVersion} · age {planning.memory.ageSeconds}
                s
              </p>
              <p>
                {planning.memory.observed} observed transitions ·{" "}
                {planning.memory.inferred} inferred transitions
              </p>
              <ol>
                {planning.memory.path.map((edge, i) => (
                  <li key={i}>
                    {edge.from} → {edge.to} · {edge.evidence} ·{" "}
                    {edge.active ? "active" : "inactive"} · age{" "}
                    {edge.ageSeconds}s
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}
      <h3>Live verification history</h3>
      <ol>
        {diagnostics.events.map((event) => (
          <li key={event.sequence}>
            {event.kind} · {event.outcome} · {event.evidence} · revision{" "}
            {event.beforeRevision} → {event.revision}
          </li>
        ))}
      </ol>
      {!diagnostics.events.length && (
        <p>No guided interactions recorded yet.</p>
      )}
      <button onClick={download}>Export diagnostics</button>
      <p className="small">
        The report contains bounded scores, rejection codes, fingerprints and
        verification evidence. Page text, goals, URLs, model text and field
        values are excluded. Up to 50 candidates and 30 events are retained.
      </p>
    </>
  );
}
