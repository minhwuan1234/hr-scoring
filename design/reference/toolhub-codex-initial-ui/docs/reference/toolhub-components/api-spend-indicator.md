/SpendIndicator.Position/ *Place a compact API spend bar in the shared top bar beside the usage bell and account role.*
/SpendIndicator.Visual/ *Show only a 7px-high progress bar. Do not show visible text beside or above it. Keep detailed spend and limit in the hover title and accessible meter description.*
/SpendIndicator.Status/ *Use amber near 80% of the limit and red at the limit. Keep the bar compact on narrow screens.*
/SpendIndicator.Budget/ *The $5 lifetime application budget is shared by every agent using the one OPENAI_API_KEY, including chat and MCP calls.*
/SpendIndicator.Tracking/ *Read token usage from each GPT-5.6 Luna response, price input, cached input, cache writes, and output, and persist the estimate in PostgreSQL.*
/SpendIndicator.Reservation/ *Reserve a conservative maximum before each call so concurrent agents cannot bypass the cap. Stop calls when the cap cannot accommodate the reservation.*
/SpendIndicator.Unavailable/ *Show unavailable when tracking cannot be loaded. Never show an invented zero.*
/SpendIndicator.Scope/ *Identify this as Toolhub agent API spend, distinct from the Railway usage bell. It covers calls made by this application since tracking was installed, not earlier calls or other users of the same key.*
/SpendIndicator.LimitMeaning/ *The dollar budget is a spend limit, not a provider requests-per-minute rate limit.*
