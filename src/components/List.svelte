{#if courses}
	{#each courses as course, i}
		<Summary bind:course={course} />
	{/each}

{:else}
	<p class="loading">loading...</p>
{/if}

<script>
    import Summary from "./Summary.svelte";

    export let courses;
</script>