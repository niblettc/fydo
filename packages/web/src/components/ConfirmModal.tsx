import { useEffect, useId, useRef } from 'react'

interface Props {
  title: string
  body: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/** Blocking confirm dialog. Escape and the backdrop cancel. */
export function ConfirmModal({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: Props) {
  const titleId = useId()
  const bodyId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    confirmRef.current?.focus()

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [onCancel])

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <p id={bodyId} className="modal-body">
          {body}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn subtle" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className="btn primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
