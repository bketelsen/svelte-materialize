<div class="container">
	<div class="section">
		<h1>
			Project 1
		</h1>
		<p>
			Projects for { $auth_response.email }
		</p>
		<ul>

			<li><a href="/">Home</a></li>
		</ul>
		<a class="waves-effect waves-light btn">button</a>
		<a class="waves-effect waves-light btn"><i class="material-icons left">cloud</i>early clouds</a>
		<a class="waves-effect waves-light btn"><i class="material-icons right">cloud</i>late clouds</a>

	</div>
	<br><br>
</div>
<script>
  import { auth_response } from "../stores/auth.js";
</script>