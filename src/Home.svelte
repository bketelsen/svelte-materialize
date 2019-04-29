<div class="container">
	<div class="section">
		<h1>
			Learn SvelteJS v3
		</h1>
		<p>
			Projects
		</p>
		<ul>
			{#if $auth_response}

			<li><a href="/project1">Project1</a></li>
			{:else}
			<li><a href="/login">Log In</a></li>
			{/if}
			<List bind:courses={courses} />
		</ul>
	</div>
	<br><br>
</div>
<script>
	import { auth_response } from "./stores/auth.js";
	import { onMount } from 'svelte'; 
	import  List  from './components/List.svelte';
	let courses;
	async function getdata() {
		courses = await fetch(`/courses/courses.json`).then(r => r.json());
		console.log(courses[0].name);
	}

	onMount(getdata);

</script>
