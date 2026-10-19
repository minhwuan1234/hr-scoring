/AIAgent.Default/ *New AI Agent graph nodes start inactive and open a setup dialog.*
/AIAgent.Dialog/ *Use the shared node dialog size, header, padding, fields, and scrolling rules.*
/AIAgent.Fields/ *Provide Instruction prompt, Explicit input, and Structured output JSON fields. Save them independently for each graph node.*
/AIAgent.Instruction/ *Instruction prompt augments the server-side agent instructions.*
/AIAgent.Input/ *Explicit input is the task sent to the model. It may reference tags from directly connected active Context Builders.*
/AIAgent.TagPicker/ *Typing slash offers only tags from directly connected active Context Builders. Show selected tags with the existing gray treatment.*
/AIAgent.OutputSchema/ *Structured output stores a strict object JSON Schema. The default UI/UX schema requires html, css, and js string fields.*
/AIAgent.Save/ *Validate the saved schema and activate the node when it is saved.*
/AIAgent.Edit/ *Open the node editor by double-clicking the node or choosing its context menu action.*
/AIAgent.Run/ *Running explicitly invokes the UI/UX agent through the server-side OpenAI Responses API using the shared server key and the $5 spend budget. Never expose the key in the browser.*
/AIAgent.InputAssembly/ *Run uses Explicit input and tasks from directly linked active Workflow nodes. Expand only named tags each node can access and include available data from a linked Receive handoff. Do not inject other context sections or files.*
/AIAgent.Output/ *Require the model response to match the saved JSON Schema. Store the latest JSON output with the node and make it available to downstream Toolhub handoffs. JSON fields are output data, not downloadable files.*
/AIAgent.NoImplicitRun/ *Changing a link or schema does not call a model.*
/AIAgent.OtherNodeTypes/ *Tool Calling, Human Approval, and Skill nodes start inactive and have no configuration or execution behavior yet. Other automatic graph execution behavior comes later.*
