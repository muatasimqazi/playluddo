import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

/** Loads and prepares a curated VRM asset for the room avatar runtime. */
export async function loadVrmAvatar(url: string): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) throw new Error(`No VRM data found in ${url}`);

  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.removeUnnecessaryJoints(vrm.scene);
  VRMUtils.combineSkeletons(vrm.scene);
  vrm.scene.traverse((object) => {
    object.frustumCulled = false;
  });
  return vrm;
}
