# Vue and Svelte adapters

The DOM controllers take an element and a flavor, so they work in any framework.
`@hannasage/armature/vue` and `@hannasage/armature/svelte` are two thin layers on top of them.

Each adapter does two things.
It makes a controller when the element mounts.
It destroys the controller when the element leaves.
It holds no motion logic. It has no spring, no frame loop, and no timer.
The motion is in the controller, and the numbers are in the flavor.

Both adapters wrap the same four controllers, and each takes the same options as the controller:

- the surface, `attachSurface`: the press, the glint, and the glow. It needs a flavor with a `surface` part.
- the follower, `createFollower`: one number that springs to a target and is written as a CSS variable. It needs a flavor with a `followers` part and the name of a follower.
- the drag, `createDrag`, from `@hannasage/armature/gesture`. It needs a flavor with a `gesture` part.
- the layout, `createLayout`, from `@hannasage/armature/layout`. It needs a flavor with a `layout` part.

An adapter does not import glass code, React code, or the CSS output. The flavor is always passed in.
The options are read once, when the element mounts. To use a new flavor or a new name, mount the element again.

Vue and Svelte are optional peer dependencies, as React is. The supported ranges are Vue `^3.5.0` and Svelte `^5.0.0`.
`docs/baseline.md`, section "G7 build", shows how the ranges were chosen.

## Vue

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useArmatureFollower } from "@hannasage/armature/vue";
import { myFlavor } from "./flavor";

const thumb = ref<HTMLElement | null>(null);
const { controller, failed } = useArmatureFollower(thumb, { flavor: myFlavor, name: "thumb" });

function toggle(on: boolean) {
  controller.value?.setTarget(on ? 1 : 0);
}
</script>

<template>
  <span ref="thumb" />
</template>
```

The composables are `useArmatureSurface`, `useArmatureFollower`, `useArmatureDrag`, and `useArmatureLayout`.
Each takes a template ref and the options of its controller. Each returns the same two values:

- `controller` is a ref. It holds the controller while the component is mounted. It holds `null` before the mount, after the unmount, on the server, and after a failed start.
- `failed` is a ref. It holds the error of a failed start, and `undefined` otherwise.

A failed start, such as a flavor with no `followers` part, is logged once with the label of the flavor, for example `[acme-motion] acme follower failed to start and was skipped.` The page keeps working, and the error shows in `failed`.
A call with no options is treated as a call with no flavor.
If the ref is empty when the component mounts, for example because the element sits behind a `v-if`, the composable warns once, sets `failed`, and makes no controller.
Inside `<KeepAlive>` a cached component stays mounted, so its controller keeps running. Unmount the component, or give it a `key`, to destroy the controller.

On the server Vue runs no mount hook, so no composable makes a controller, and none touches a browser global.
Call each composable inside `setup`, because it registers the mount hooks of the component.

## Svelte

```svelte
<script>
  import { follow, surface } from "@hannasage/armature/svelte";
  import { myFlavor } from "./flavor";

  let thumb = $state(null);
</script>

<button use:surface={{ flavor: myFlavor }}>Press</button>
<span use:follow={{ flavor: myFlavor, name: "thumb", onReady: (follower) => (thumb = follower) }}></span>
```

The actions are `surface`, `follow`, `drag`, and `layout`. They work with the `use:` directive.
Each takes the options of its controller, and two hooks:

- `onReady(controller)` is called with the controller when the node mounts, and with `null` when the node leaves. This is how a component gets the controller to call `setTarget` or `play`.
- `onError(error, context)` is called with the error of a failed start or a failed stop, in place of the log line. If `onError` throws, its error is logged with `console.error`, together with the original error.

An action returns `{ destroy }` and no `update`: the options are read once, when the node mounts. To start again with new options, wrap the node in `{#key}`.
If `onReady` throws when the node mounts, the controller is destroyed, `onReady(null)` is called so the component drops it, and the error is reported as a failed start.
Svelte runs no action on the server, so nothing here runs there.
`@hannasage/armature/svelte` imports nothing from Svelte, so it also works with an action-compatible tool.

## Tests

The tests of both adapters render on the server and mount and destroy a controller:

- Vue: a component is rendered to a string with `renderToString` from `vue/server-renderer`. It is also mounted with Vue's own `createRenderer` on nodes that need no DOM, so the real `onMounted` and `onBeforeUnmount` hooks run.
- Svelte: a component that uses every action is compiled with `compile` from `svelte/compiler` with `generate: "server"`, and rendered with `render` from `svelte/server`. A second compile with `generate: "client"` checks that each `use:` directive calls the action. The action functions are also called by hand, with fake environments, as Svelte calls them.
