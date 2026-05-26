<script lang="ts">
  // Drop zone — accepts ONE OR MORE PDFs at a time.  When the user drops
  // multiple files (or selects multiple via the file picker), they all get
  // forwarded to the parent in a single batch.  The parent queues them and
  // processes serially so the persistence-layer write mutex doesn't get
  // contended.

  interface Props {
    onFiles: (files: File[]) => void;
    disabled?: boolean;
  }
  let { onFiles, disabled = false }: Props = $props();

  let dragging = $state(false);
  let inputEl = $state<HTMLInputElement | null>(null);

  function filterPdfs(list: FileList | null | undefined): File[] {
    if (!list) return [];
    const out: File[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list.item(i);
      if (!f) continue;
      // Accept by extension OR by MIME type.  Some browsers don't sniff PDF
      // MIME reliably across all drag sources.
      if (/\.pdf$/i.test(f.name) || f.type === 'application/pdf') {
        out.push(f);
      }
    }
    return out;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    if (disabled) return;
    const files = filterPdfs(e.dataTransfer?.files);
    if (files.length > 0) onFiles(files);
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (!disabled) dragging = true;
  }

  function handleDragLeave() {
    dragging = false;
  }

  function pick() {
    if (!disabled) inputEl?.click();
  }

  function handleSelect(e: Event) {
    const t = e.currentTarget as HTMLInputElement;
    const files = filterPdfs(t.files);
    if (files.length > 0) onFiles(files);
    t.value = '';
  }
</script>

<div
  role="button"
  tabindex="0"
  class="dropzone block w-full cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center"
  class:dragging
  class:opacity-50={disabled}
  class:cursor-not-allowed={disabled}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
  onclick={pick}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && pick()}
  aria-label="Drop one or more PDF files here, or click to choose"
>
  <span
    class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
    style="background-image: var(--grad-primary); color: var(--color-accent-fg); box-shadow: var(--shadow-primary);"
  >
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M5 20h14" />
    </svg>
  </span>
  <p class="text-lg font-semibold" style:color="var(--color-text)">
    Drop your bank or credit-card statements
  </p>
  <p class="mt-1 text-sm" style:color="var(--color-muted)">
    PDF files — they never leave your browser
  </p>
  <span class="btn btn-ghost mt-4">Choose files</span>
</div>

<input
  bind:this={inputEl}
  type="file"
  accept="application/pdf,.pdf"
  multiple
  class="hidden"
  onchange={handleSelect}
/>

<style>
  .dropzone {
    background-color: var(--color-surface);
    border-color: var(--color-border);
    box-shadow: var(--shadow);
    transition:
      border-color 0.2s ease,
      background-color 0.2s ease,
      transform 0.2s ease,
      box-shadow 0.2s ease;
  }
  .dropzone:hover {
    border-color: var(--color-accent);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }
  .dropzone.dragging {
    border-color: var(--color-accent);
    background-color: var(--color-accent-soft);
  }
</style>
