import { Component, createMemo } from "solid-js"
import { marked } from "marked"
import DOMPurify from "dompurify"

marked.setOptions({
  breaks: true,
  gfm: true,
})

interface MarkdownRendererProps {
  content: string
  class?: string
}

const MarkdownRenderer: Component<MarkdownRendererProps> = (props) => {
  const html = createMemo(() => {
    const raw = marked.parse(props.content)
    return DOMPurify.sanitize(raw as string, {
      ADD_TAGS: ["img"],
      ADD_ATTR: ["src", "alt", "title", "width", "height"],
    })
  })

  return (
    <div
      class={`md-content ${props.class || ""}`}
      innerHTML={html()}
    />
  )
}

export default MarkdownRenderer
