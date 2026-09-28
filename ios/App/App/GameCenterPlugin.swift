import Foundation
import Capacitor
import GameKit

/// Game Center for the web game: sign in the local player, post leaderboard
/// scores, report achievements, and show Apple's leaderboard/achievement
/// screens. Called from lib/gameCenter.ts as `GameCenter`. Leaderboard and
/// achievement IDs must exist in App Store Connect (see docs/IOS_RELEASE.md).
@objc(GameCenterPlugin)
public class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportAchievement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showAchievements", returnType: CAPPluginReturnPromise),
    ]

    /// Calls waiting on the first authentication round (the handler is set
    /// once and GameKit calls it back asynchronously, possibly after showing
    /// its own sign-in sheet).
    private var pendingAuth: [CAPPluginCall] = []
    private var authInFlight = false

    @objc func authenticate(_ call: CAPPluginCall) {
        let player = GKLocalPlayer.local
        if player.isAuthenticated {
            call.resolve(playerInfo(nil))
            return
        }
        pendingAuth.append(call)
        if authInFlight { return }
        authInFlight = true
        DispatchQueue.main.async {
            player.authenticateHandler = { [weak self] viewController, error in
                guard let self = self else { return }
                if let viewController = viewController {
                    // Not signed in on this device yet: Apple's sign-in sheet.
                    self.bridge?.viewController?.present(viewController, animated: true)
                    return
                }
                let calls = self.pendingAuth
                self.pendingAuth = []
                self.authInFlight = false
                let info = self.playerInfo(error)
                calls.forEach { $0.resolve(info) }
            }
        }
    }

    private func playerInfo(_ error: Error?) -> [String: Any] {
        let player = GKLocalPlayer.local
        var info: [String: Any] = ["authenticated": player.isAuthenticated]
        if player.isAuthenticated {
            info["playerId"] = player.teamPlayerID
            info["displayName"] = player.displayName
        }
        if let error = error { info["error"] = error.localizedDescription }
        return info
    }

    private func requireAuthenticated(_ call: CAPPluginCall) -> Bool {
        if GKLocalPlayer.local.isAuthenticated { return true }
        call.reject("Game Center player is not signed in", "NOT_AUTHENTICATED")
        return false
    }

    @objc func submitScore(_ call: CAPPluginCall) {
        guard requireAuthenticated(call) else { return }
        guard let leaderboardId = call.getString("leaderboardId"), let score = call.getInt("score") else {
            call.reject("leaderboardId and score are required")
            return
        }
        GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local, leaderboardIDs: [leaderboardId]) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }

    /// The local player's current all-time score on a leaderboard (0 if none).
    @objc func getScore(_ call: CAPPluginCall) {
        guard requireAuthenticated(call) else { return }
        guard let leaderboardId = call.getString("leaderboardId") else {
            call.reject("leaderboardId is required")
            return
        }
        GKLeaderboard.loadLeaderboards(IDs: [leaderboardId]) { leaderboards, error in
            guard let leaderboard = leaderboards?.first else {
                call.reject(error?.localizedDescription ?? "Leaderboard not found")
                return
            }
            leaderboard.loadEntries(for: [GKLocalPlayer.local], timeScope: .allTime) { local, _, error in
                if let error = error { call.reject(error.localizedDescription); return }
                call.resolve(["score": local?.score ?? 0])
            }
        }
    }

    @objc func reportAchievement(_ call: CAPPluginCall) {
        guard requireAuthenticated(call) else { return }
        guard let achievementId = call.getString("achievementId") else {
            call.reject("achievementId is required")
            return
        }
        let achievement = GKAchievement(identifier: achievementId)
        achievement.percentComplete = call.getDouble("percentComplete") ?? 100
        achievement.showsCompletionBanner = true
        GKAchievement.report([achievement]) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }

    @objc func showLeaderboard(_ call: CAPPluginCall) {
        guard requireAuthenticated(call) else { return }
        DispatchQueue.main.async {
            let controller: GKGameCenterViewController
            if let leaderboardId = call.getString("leaderboardId") {
                controller = GKGameCenterViewController(leaderboardID: leaderboardId, playerScope: .global, timeScope: .allTime)
            } else {
                controller = GKGameCenterViewController(state: .leaderboards)
            }
            self.present(controller, call)
        }
    }

    @objc func showAchievements(_ call: CAPPluginCall) {
        guard requireAuthenticated(call) else { return }
        DispatchQueue.main.async {
            self.present(GKGameCenterViewController(state: .achievements), call)
        }
    }

    private func present(_ controller: GKGameCenterViewController, _ call: CAPPluginCall) {
        controller.gameCenterDelegate = self
        bridge?.viewController?.present(controller, animated: true)
        call.resolve()
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}
