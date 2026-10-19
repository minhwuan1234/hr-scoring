# Toolhub UI design system

Version 4.2 · 2026-10-08 · English interface

/Design.Index/ *This file indexes the Toolhub UI screen context collection. Each file under contexts/ui-screen/ describes one basic part of a screen.*
/Design.RuleSyntax/ *Write each normative design decision as a named slash block containing one concise requirement.*
/Design.SourceOfTruth/ *Treat named slash blocks in the component context files as the source of truth when designing or reviewing a screen.*
/Design.MeasuredValues/ *Use the numeric dimensions, breakpoints, and color values in the screen contexts. They are taken from the current Toolhub CSS; update the relevant context when the matching UI changes.*
/Design.Unknowns/ *Do not invent behavior, content, or visual rules where the specification is silent. Surface the open question instead.*

## Basic screen contexts

- [Screen structure and content hierarchy](contexts/ui-screen/screen-structure.md)
- [Layout and spacing](contexts/ui-screen/layout-spacing.md)
- [Color](contexts/ui-screen/color.md)
- [Typography](contexts/ui-screen/typography.md)
- [Surfaces](contexts/ui-screen/surface.md)
- [Navigation](contexts/ui-screen/navigation.md)
- [Buttons](contexts/ui-screen/button.md)
- [Inputs and forms](contexts/ui-screen/input-form.md)
- [Content display](contexts/ui-screen/content-display.md)
- [Icons and media](contexts/ui-screen/icon-media.md)
- [States and feedback](contexts/ui-screen/state-feedback.md)
- [Responsive behavior and accessibility](contexts/ui-screen/responsive-accessibility.md)

## Usage

/Design.RuleFormat/ *Give every rule a clear name and one concise requirement.*
/Design.ReadScope/ *In Context Builder, attach the basic screen contexts relevant to the design assignment. Reference the needed slash tags explicitly from the AI Agent input.*
/Design.UIUXScope/ *UI/UX deliverables are designs or prototypes only unless a request explicitly asks for working behavior. A visible control does not imply a real API, persistence, or action.*
/Design.ContextSelection/ *Keep screen contexts independent. Connect only the contexts required for a task; do not load or merge every file by default.*
/Design.ProductReference/ *Existing Toolhub feature specifications are preserved under docs/reference/toolhub-components/ for reference and are not part of the basic screen context collection.*
/Design.Archive/ *Historical LinkedIn scanner guidance is archived at design/archive/linkedin-scanner-v2.md and does not apply to Toolhub.*

## Maintenance

/Design.Maintenance/ *When a basic UI rule changes, update its screen context file and this index if the file map or usage rules change. Keep each context focused on one screen element.*
/Design.Loading/ *The UI/UX Graph presents each screen context as a Context Builder node. A node becomes available to an AI Agent only through a graph connection, and its tags are included in input only when explicitly referenced.*
