<main>
<Nav />

<svelte:component this={page} />

</main>
<Footer />
<script>
  import router from "page";
  import { setContext } from "svelte";
  import Nav from "./components/Nav.svelte";
  import Hero from "./components/Hero.svelte";
  import Footer from "./components/Footer.svelte";
  import Home from "./Home.svelte";
  import Login from "./Login.svelte";
  import Project1 from "./project1/Index.svelte";
  import GoTrue from "gotrue-js";
  import { gotrue, auth_response } from "./stores/auth.js";

  function checkAuth(ctx, next) {
    if (!isEmpty($auth_response)) {
      next();
    } else {
      console.log("redirect no login");
      console.log($auth_response);
      router.redirect("/login");
    }
  }

  function isEmpty(obj) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) return false;
    }
    return true;
  }

  const auth = new GoTrue({
    APIUrl: "http://127.0.0.1:9999",
    audience: "",
    setCookie: false
  });

  gotrue.set(auth);

  let page = Home;

  router("/", () => (page = Home));
  router("/login", () => (page = Login));
  router("/project1", checkAuth, () => (page = Project1));

  router.start();
</script>