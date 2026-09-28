import UIKit
import Capacitor

/// The app's web view controller (set in Main.storyboard). Exists to register
/// plugins that live in this app target rather than in an npm package.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(GameCenterPlugin())
    }
}
