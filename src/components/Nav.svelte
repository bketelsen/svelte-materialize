<nav class="teal lighten-1" role="navigation">
	<div class="nav-wrapper container"><a id="logo-container" href="#" class="brand-logo">Logo</a>
		<ul class="right hide-on-med-and-down">
			<li><a href="/">Home</a></li>
			{#if $auth_response}

			<li><a href="/profile">Profile</a></li>
			{:else}
			<li><a href="/login">Log In</a></li>
			{/if}
		</ul>

		<ul id="nav-mobile" class="sidenav">
			<li><a href="/">Home</a></li>
			{#if $auth_response}

			<li><a href="/profile">Profile</a></li>
			{:else}
			<li><a href="/login">Log In</a></li>
			{/if}
		</ul>
		<a href="#" data-target="nav-mobile" class="sidenav-trigger"><i class="material-icons">menu</i></a>
	</div>
</nav>

<script>
	import { auth_response } from "../stores/auth.js";
</script>
