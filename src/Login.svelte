<div class="container">
	<div class="section">
		<h1>
			Login
		</h1>
		<ul>
			<li><a href="/">Home</a></li>
		</ul>
		<div>
			<input bind:value={user_email}><br />
			<input type=password bind:value={user_password}>
			<button on:click={loginClick}>
				Login
			</button>
		</div>
	</div>
	<br><br>
</div>
<script>
	import { getContext } from 'svelte';
	import router from 'page';
	import { gotrue, auth_response } from './stores/auth.js';
	let user_email = '';
	let user_password = '';


	function loginClick() {
		$gotrue	
			.login(user_email, user_password)
			.then(response => {
				alert("Success! Response: " + JSON.stringify({ response }));
				auth_response.set(response);
    			router.redirect('/');
			})
			.catch(error => alert("Failed :( " + JSON.stringify(error)));
	}
</script>
