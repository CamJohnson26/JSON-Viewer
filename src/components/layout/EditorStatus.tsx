interface EditorStatusProps {
  readonly message: string
}

export function EditorStatus({ message }: EditorStatusProps) {
  return (
    <footer aria-label="Editor status" className="status-bar">
      <span aria-live="polite">{message}</span>
    </footer>
  )
}
