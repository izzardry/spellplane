<!--
  About Spellplane (PLAN M5-P5; DESIGN "Card data and images", Legal position: the About panel shows the Fan Content
  Policy disclaimer; Scryfall and MTGJSON credits). Links open in a new tab and are never fetched by the app.
-->
<script lang="ts">
  import { ABOUT_TEXT, CREDITS, FAN_CONTENT_NOTICE, FAN_CONTENT_POLICY_URL, LICENCE, SOURCE_URL } from './about';

  let { onclose, embedded = false }: { onclose?: () => void; embedded?: boolean } = $props();
</script>

<section class="about" class:embedded data-testid="about" aria-labelledby="sp-about-title">
  <header>
    <h2 id="sp-about-title">About Spellplane</h2>
    {#if onclose}<button type="button" class="x" data-testid="about-close" aria-label="Close" onclick={onclose}>×</button>{/if}
  </header>
  {#each ABOUT_TEXT as p (p)}<p>{p}</p>{/each}

  <h3>Fan Content Policy</h3>
  <p class="notice" data-testid="fan-content-notice">{FAN_CONTENT_NOTICE}</p>
  <p><a href={FAN_CONTENT_POLICY_URL} target="_blank" rel="noopener noreferrer" data-testid="fan-content-link">Wizards of the Coast Fan Content Policy</a></p>

  <h3>Credits</h3>
  <ul class="credits">
    {#each CREDITS as c (c.id)}
      <li data-testid="credit" data-credit={c.id}>
        <a href={c.url} target="_blank" rel="noopener noreferrer">{c.name}</a>: {c.text}
      </li>
    {/each}
  </ul>

  <h3>Source</h3>
  <p>Open source under the {LICENCE} licence: <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{SOURCE_URL.replace(/^https:\/\//, '')}</a>.</p>
</section>

<style>
  .about {
    box-sizing: border-box;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #8c8c8c);
    border-radius: var(--sp-radius-lg, 8px);
    padding: var(--sp-space-lg, 16px);
    font: var(--sp-font-size-small, 12px) / 1.5 var(--sp-font, system-ui);
    max-width: 40em;
  }
  .about.embedded {
    border: none;
    padding: 0;
    background: none;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  h2 {
    margin: 0 0 8px;
    font-size: var(--sp-font-size-large, 18px);
  }
  h3 {
    margin: 12px 0 4px;
    font-size: var(--sp-font-size, 14px);
  }
  p {
    margin: 0 0 6px;
  }
  .notice {
    padding: 8px;
    border-left: 3px solid var(--sp-border, #8c8c8c);
  }
  .credits {
    margin: 0;
    padding-left: 18px;
  }
  .credits li {
    margin: 0 0 4px;
  }
  a {
    color: var(--sp-fg, #111);
  }
  .x {
    font: inherit;
    font-size: 16px;
    background: none;
    color: inherit;
    border: none;
    cursor: pointer;
  }
</style>
