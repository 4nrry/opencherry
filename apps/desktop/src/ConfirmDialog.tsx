import { createSignal, JSX, Show, createEffect, onMount, onCleanup } from "solid-js";

export type ConfirmRequest = {
  title: string;
  body: string | JSX.Element;
  confirmLabel: string;
  confirmTone?: "danger" | "primary";
  onConfirm: () => Promise<void> | void;
};

export function ConfirmDialog(props: {
  request: ConfirmRequest | null;
  onClose: () => void;
}): JSX.Element {
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let cancelRef: HTMLButtonElement | undefined;

  createEffect(() => {
    if (props.request) {
      setPending(false);
      setError(null);
    }
  });

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && props.request && !pending()) {
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    onCleanup(() => window.removeEventListener("keydown", onKey));
  });

  const handleConfirm = async () => {
    const req = props.request;
    if (!req) return;
    setPending(true);
    try {
      await req.onConfirm();
      setPending(false);
      props.onClose();
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Show when={props.request} keyed>
      {(req) => {
        queueMicrotask(() => cancelRef?.focus());
        return (
          <div
            class="confirm-dialog__overlay"
            onClick={() => !pending() && props.onClose()}
          >
            <div
              class="confirm-dialog__panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirm-dialog-title"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="confirm-dialog-title" class="confirm-dialog__title">
                {req.title}
              </h2>
              <div class="confirm-dialog__body">{req.body}</div>
              <Show when={error()}>
                <div class="banner banner--error" role="alert">
                  {error()}
                </div>
              </Show>
              <div class="confirm-dialog__actions">
                <Show
                  when={!error()}
                  fallback={
                    <button
                      type="button"
                      class="btn"
                      onClick={() => props.onClose()}
                    >
                      Close
                    </button>
                  }
                >
                  <button
                    type="button"
                    class="btn"
                    ref={(el) => (cancelRef = el)}
                    disabled={pending()}
                    onClick={() => props.onClose()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class={
                      req.confirmTone === "danger"
                        ? "btn btn--danger"
                        : "btn btn--primary"
                    }
                    disabled={pending()}
                    onClick={handleConfirm}
                  >
                    {req.confirmLabel}
                  </button>
                </Show>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
