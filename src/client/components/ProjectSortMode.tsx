import { ArrowLeft, ArrowRight, GripVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent } from "react";
import type { ProjectSummary } from "../../shared/contracts";
import { apiFetch } from "../api";
import { ProjectCard } from "./ProjectCard";

export function ProjectSortMode({ projects, onClose, onSaved }: {
  projects: ProjectSummary[]; onClose: () => void; onSaved: () => void;
}) {
  const [draft, setDraft] = useState(projects);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const dragging = useRef<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const preview = useRef<{ element: HTMLDivElement; offsetX: number; offsetY: number } | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const frame = useRef<number | null>(null);
  const trackPreview = useCallback((event: DragEvent) => {
    pointer.current = { x: event.clientX, y: event.clientY };
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const active = preview.current;
      if (active) active.element.style.transform = `translate3d(${pointer.current.x - active.offsetX}px, ${pointer.current.y - active.offsetY}px, 0)`;
    });
  }, []);
  const removePreview = useCallback(() => {
    document.removeEventListener("dragover", trackPreview);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    preview.current?.element.remove();
    preview.current = null;
  }, [trackPreview]);
  useEffect(() => removePreview, [removePreview]);
  function startPreview(event: ReactDragEvent<HTMLLIElement>) {
    removePreview();
    const card = event.currentTarget.querySelector<HTMLElement>(".project-card");
    if (!card || typeof event.dataTransfer.setDragImage !== "function") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const element = document.createElement("div");
    element.className = "project-sort-drag-preview projects-page";
    element.setAttribute("aria-hidden", "true");
    element.inert = true;
    element.style.width = `${bounds.width}px`;
    element.style.height = `${bounds.height}px`;
    element.style.transform = `translate3d(${bounds.left}px, ${bounds.top}px, 0)`;
    const copy = card.cloneNode(true) as HTMLElement;
    copy.removeAttribute("aria-labelledby");
    copy.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
    element.append(copy);
    preview.current = { element, offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top };
    document.body.append(element);
    // Hide the native bitmap; the live, inert copy follows drag events instead.
    const blank = document.createElement("canvas");
    blank.width = blank.height = 1;
    event.dataTransfer.setDragImage(blank, 0, 0);
    document.addEventListener("dragover", trackPreview, { passive: true });
  }
  function endDrag() { removePreview(); dragging.current = null; setDraggedId(null); setDropTarget(null); }
  function move(id: string, target: number) {
    if (busy || target < 0 || target >= draft.length) return;
    const next = [...draft];
    const from = next.findIndex((project) => project.id === id);
    if (from < 0 || from === target) return;
    const [item] = next.splice(from, 1); next.splice(target, 0, item);
    setDraft(next); setAnnouncement(`${item.name} moved to position ${target + 1}.`);
  }
  async function save() {
    setBusy(true); setError("");
    try {
      await apiFetch<void>("/api/v1/projects/order", { method: "PUT", body: JSON.stringify({
        ordered_ids: draft.map((p) => p.id), expected_ids: projects.map((p) => p.id)
      }) });
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save project order."); }
    finally { setBusy(false); }
  }
  return <div className="project-sort" role="region" aria-label="Sort Projects">
    <div className="section-heading project-sort-toolbar"><div><p>Drag the cards to change their order, then save. Move buttons are also available.</p></div>
      <div className="project-sort__actions"><button type="button" className="button button--secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving Order…" : "Save Order"}</button></div>
    </div>
    {error && <p className="quiet-message field__help--error" role="alert">{error}</p>}
    <span className="visually-hidden" role="status">{announcement}</span>
    <ul className="project-card-grid project-card-grid--sorting">{draft.map((project, index) => <li key={project.id}
      className={`${draggedId === project.id ? "project-card-sortable--dragging" : ""} ${dropTarget === project.id ? "project-card-sortable--over" : ""}`}
      draggable={!busy} onDragStart={(event) => { startPreview(event); dragging.current = project.id; setDraggedId(project.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", project.id); }}
      onDragEnd={endDrag} onDragOver={(event) => { if (!busy && dragging.current) { event.preventDefault(); setDropTarget(dragging.current === project.id ? null : project.id); } }}
      onDrop={(event) => { event.preventDefault(); if (dragging.current) move(dragging.current, index); endDrag(); }}>
      <ProjectCard project={project} sortingControls={<div className="project-card-sort-controls">
        <span className="project-sort-grip"><GripVertical aria-hidden="true" />Drag To Reorder</span>
        <button type="button" className="icon-button" title="Move Earlier" aria-label={`Move ${project.name} Earlier`} disabled={busy || index === 0} onClick={() => move(project.id, index - 1)}><ArrowLeft aria-hidden="true" /></button>
        <button type="button" className="icon-button" title="Move Later" aria-label={`Move ${project.name} Later`} disabled={busy || index === draft.length - 1} onClick={() => move(project.id, index + 1)}><ArrowRight aria-hidden="true" /></button>
      </div>} />
    </li>)}</ul>
  </div>;
}
