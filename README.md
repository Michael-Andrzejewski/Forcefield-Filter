Welcome to Forcefield! This is my experimental attempt to filter all incoming internet text traffic through an LLM.
Forcefield is based on the following philosophies:
- People are naturally good and happy by default! Most value is lost by adding bad content to their feed
- People are often subconsciously drawn to content they don't consciously like. The average person will engage more with a post that is wrong than with a post that is right. Attention is a subpar optimizer for good content.
- Superpersuasion happens in the negative. It's hard to persuade something that they like something, but easy to persuade someone that they don't like something.

Most importantly:
- The only way to fix the misaligned incentives of social media networks (attention = ad revenue) is to have a system that alows a person to *consciously* choose what they want to block and have this system constantly work with *no mental effort* cost. You can fix your social media feed by consciously + constantly selecting 'Not Interested' to content you don't want to see, but this will take too much mental effort and eventually you'll give up and go back to doomscrolling.

Forcefield is designed to save you the mental effort.

This is version 1, a proof of concept implementation. It's not great. While functional, it has the following known issues:
- Blocks too much content, including things that shouldn't be blocked.
- Only blocks text (images will slip through if Forcefield doesn't identify the caption as bad)
- It's somewhat expensive, at around 1 dollar per hour of browsing.

Roadmap:
- Finetune a model to make the default blocking behavior much better
- Add non-LLM filtering systems so the extension can run more cheaply or for free
- Improve custom filtering (maybe a dial that changes the blocking strictness or allows the user to directly block content with a prompt
- Better UI/UX.
- Promote.
