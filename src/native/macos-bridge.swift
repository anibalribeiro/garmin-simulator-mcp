import Cocoa
import CoreGraphics
import ApplicationServices
import Foundation

// Helper to output JSON to stdout
func printJSON(_ object: Any) {
    if let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else {
        print("{\"error\":\"Failed to serialize JSON\"}")
    }
}

func getPermissions() -> [String: Bool] {
    let screenRecording = CGPreflightScreenCaptureAccess()
    let accessibility = AXIsProcessTrusted()
    return [
        "screenRecording": screenRecording,
        "accessibility": accessibility
    ]
}

func findSimulatorApp() -> NSRunningApplication? {
    // 1. By bundle identifier
    for app in NSWorkspace.shared.runningApplications {
        if app.bundleIdentifier == "com.garmin.connectiq.simulator" {
            return app
        }
    }
    // 2. By localized name or path
    for app in NSWorkspace.shared.runningApplications {
        if let name = app.localizedName, (name == "Connect IQ Device Simulator" || name == "simulator") {
            if let path = app.bundleURL?.path ?? app.executableURL?.path, path.contains("ConnectIQ") || path.contains("connectiq") {
                return app
            }
            if name == "Connect IQ Device Simulator" {
                return app
            }
        }
    }
    // 3. By window owner name in window list
    if let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] {
        for w in windowList {
            let owner = w[kCGWindowOwnerName as String] as? String ?? ""
            if owner == "Connect IQ Device Simulator" {
                if let pid = w[kCGWindowOwnerPID as String] as? pid_t {
                    if let app = NSRunningApplication(processIdentifier: pid) {
                        return app
                    }
                }
            }
        }
    }
    return nil
}

func findSimulatorWindow(pid: pid_t?) -> [String: Any]? {
    guard let windowList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
        return nil
    }
    
    for w in windowList {
        let layer = w[kCGWindowLayer as String] as? Int ?? -1
        guard layer == 0 else { continue }
        
        let ownerPid = w[kCGWindowOwnerPID as String] as? pid_t
        let ownerName = w[kCGWindowOwnerName as String] as? String ?? ""
        
        let pidMatches: Bool
        if let targetPid = pid {
            pidMatches = (ownerPid == targetPid)
        } else {
            pidMatches = (ownerName == "Connect IQ Device Simulator")
        }
        
        guard pidMatches else { continue }
        
        if let boundsDict = w[kCGWindowBounds as String] as? [String: Any],
           let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) {
            if bounds.width > 100 && bounds.height > 100 {
                return w
            }
        }
    }
    return nil
}

func handleWindowInfo() {
    let permissions = getPermissions()
    guard let app = findSimulatorApp() else {
        printJSON([
            "running": false,
            "permissions": permissions,
            "error": "Connect IQ simulator is not running"
        ])
        return
    }
    
    let pid = app.processIdentifier
    var response: [String: Any] = [
        "running": true,
        "pid": pid,
        "permissions": permissions,
        "contentOffset": ["x": 0, "y": 28]
    ]
    
    if let win = findSimulatorWindow(pid: pid),
       let windowId = win[kCGWindowNumber as String] as? CGWindowID,
       let boundsDict = win[kCGWindowBounds as String] as? [String: Any],
       let bounds = CGRect(dictionaryRepresentation: boundsDict as CFDictionary) {
        response["windowId"] = windowId
        response["bounds"] = [
            "x": bounds.origin.x,
            "y": bounds.origin.y,
            "width": bounds.size.width,
            "height": bounds.size.height
        ]
    } else {
        response["error"] = "Connect IQ simulator window not found"
    }
    
    printJSON(response)
}

func activateApp(_ app: NSRunningApplication) -> Bool {
    if #available(macOS 14.0, *) {
        return app.activate()
    } else {
        return app.activate(options: [.activateIgnoringOtherApps])
    }
}

func handleActivate() {
    guard let app = findSimulatorApp() else {
        printJSON(["ok": false, "error": "Connect IQ simulator is not running"])
        return
    }
    let success = activateApp(app)
    printJSON(["ok": success])
}

func handleClick(args: [String]) {
    var x: Double? = nil
    var y: Double? = nil
    var holdMs: Int = 80
    
    var idx = 0
    while idx < args.count {
        let arg = args[idx]
        if arg == "--x" && idx + 1 < args.count {
            x = Double(args[idx + 1])
            idx += 2
        } else if arg == "--y" && idx + 1 < args.count {
            y = Double(args[idx + 1])
            idx += 2
        } else if (arg == "--hold-ms" || arg == "--hold") && idx + 1 < args.count {
            holdMs = Int(args[idx + 1]) ?? 80
            idx += 2
        } else {
            idx += 1
        }
    }
    
    guard let targetX = x, let targetY = y else {
        printJSON(["ok": false, "error": "Missing --x or --y"])
        return
    }
    
    if let app = findSimulatorApp() {
        _ = activateApp(app)
    }
    usleep(60_000) // 60ms
    
    let pt = CGPoint(x: targetX, y: targetY)
    
    let moveEvent = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: pt, mouseButton: .left)
    moveEvent?.post(tap: .cghidEventTap)
    
    let downEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: pt, mouseButton: .left)
    downEvent?.post(tap: .cghidEventTap)
    
    usleep(useconds_t(max(1, holdMs) * 1000))
    
    let upEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: pt, mouseButton: .left)
    upEvent?.post(tap: .cghidEventTap)
    
    printJSON(["ok": true, "x": targetX, "y": targetY, "holdMs": holdMs])
}

func handleDrag(args: [String]) {
    var x1: Double? = nil
    var y1: Double? = nil
    var x2: Double? = nil
    var y2: Double? = nil
    var durationMs: Int = 150
    
    var idx = 0
    while idx < args.count {
        let arg = args[idx]
        if arg == "--x1" && idx + 1 < args.count {
            x1 = Double(args[idx + 1])
            idx += 2
        } else if arg == "--y1" && idx + 1 < args.count {
            y1 = Double(args[idx + 1])
            idx += 2
        } else if arg == "--x2" && idx + 1 < args.count {
            x2 = Double(args[idx + 1])
            idx += 2
        } else if arg == "--y2" && idx + 1 < args.count {
            y2 = Double(args[idx + 1])
            idx += 2
        } else if (arg == "--duration-ms" || arg == "--duration") && idx + 1 < args.count {
            durationMs = Int(args[idx + 1]) ?? 150
            idx += 2
        } else {
            idx += 1
        }
    }
    
    guard let startX = x1, let startY = y1, let endX = x2, let endY = y2 else {
        printJSON(["ok": false, "error": "Missing --x1, --y1, --x2, or --y2"])
        return
    }
    
    if let app = findSimulatorApp() {
        _ = activateApp(app)
    }
    usleep(60_000) // 60ms
    
    let startPt = CGPoint(x: startX, y: startY)
    let endPt = CGPoint(x: endX, y: endY)
    
    let moveEvent = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: startPt, mouseButton: .left)
    moveEvent?.post(tap: .cghidEventTap)
    
    let downEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: startPt, mouseButton: .left)
    downEvent?.post(tap: .cghidEventTap)
    
    let steps = 12
    let stepDelay = useconds_t(max(1, (durationMs * 1000) / steps))
    for i in 1...steps {
        usleep(stepDelay)
        let t = Double(i) / Double(steps)
        let curX = startX + (endX - startX) * t
        let curY = startY + (endY - startY) * t
        let dragPt = CGPoint(x: curX, y: curY)
        let dragEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDragged, mouseCursorPosition: dragPt, mouseButton: .left)
        dragEvent?.post(tap: .cghidEventTap)
    }
    
    let upEvent = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: endPt, mouseButton: .left)
    upEvent?.post(tap: .cghidEventTap)
    
    printJSON(["ok": true])
}

func handleKey(args: [String]) {
    var code: UInt16? = nil
    var holdMs: Int = 80
    
    var idx = 0
    while idx < args.count {
        let arg = args[idx]
        if (arg == "--code" || arg == "-c") && idx + 1 < args.count {
            code = UInt16(args[idx + 1])
            idx += 2
        } else if (arg == "--hold-ms" || arg == "--hold") && idx + 1 < args.count {
            holdMs = Int(args[idx + 1]) ?? 80
            idx += 2
        } else {
            idx += 1
        }
    }
    
    guard let keyCode = code else {
        printJSON(["ok": false, "error": "Missing --code"])
        return
    }
    
    if let app = findSimulatorApp() {
        _ = activateApp(app)
    }
    usleep(60_000) // 60ms
    
    let downEvent = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: true)
    downEvent?.post(tap: .cghidEventTap)
    
    usleep(useconds_t(max(1, holdMs) * 1000))
    
    let upEvent = CGEvent(keyboardEventSource: nil, virtualKey: CGKeyCode(keyCode), keyDown: false)
    upEvent?.post(tap: .cghidEventTap)
    
    printJSON(["ok": true, "keyCode": keyCode])
}

// Menu handling via AXUIElement
func getAXChildren(element: AXUIElement) -> [AXUIElement] {
    var childrenVal: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &childrenVal) == .success,
       let children = childrenVal as? [AXUIElement] {
        return children
    }
    return []
}

func getAXTitle(element: AXUIElement) -> String? {
    var titleVal: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXTitleAttribute as CFString, &titleVal) == .success,
       let title = titleVal as? String, !title.isEmpty {
        return title
    }
    return nil
}

func getSubmenuChildren(element: AXUIElement) -> [AXUIElement] {
    var submenuVal: AnyObject?
    if AXUIElementCopyAttributeValue(element, "AXSubmenu" as CFString, &submenuVal) == .success,
       let submenu = submenuVal {
        let subElement = submenu as! AXUIElement
        let subChildren = getAXChildren(element: subElement)
        if !subChildren.isEmpty {
            return subChildren
        }
    }
    
    let children = getAXChildren(element: element)
    if children.count == 1 {
        var roleVal: AnyObject?
        AXUIElementCopyAttributeValue(children[0], kAXRoleAttribute as CFString, &roleVal)
        if (roleVal as? String) == "AXMenu" {
            return getAXChildren(element: children[0])
        }
    }
    return children
}

func handleMenu(args: [String]) {
    var pathSegments: [String] = []
    var idx = 0
    while idx < args.count {
        let arg = args[idx]
        if arg == "--path" {
            idx += 1
            while idx < args.count && !args[idx].hasPrefix("--") {
                let segment = args[idx]
                if segment.contains(">") {
                    let parts = segment.components(separatedBy: ">").map { $0.trimmingCharacters(in: .whitespaces) }
                    pathSegments.append(contentsOf: parts.filter { !$0.isEmpty })
                } else {
                    let trimmed = segment.trimmingCharacters(in: .whitespaces)
                    if !trimmed.isEmpty {
                        pathSegments.append(trimmed)
                    }
                }
                idx += 1
            }
        } else {
            idx += 1
        }
    }
    
    guard !pathSegments.isEmpty else {
        printJSON(["ok": false, "error": "Missing --path <items...>"])
        return
    }
    
    guard let app = findSimulatorApp() else {
        printJSON(["ok": false, "error": "Connect IQ simulator is not running"])
        return
    }
    
    if !AXIsProcessTrusted() {
        printJSON(["ok": false, "error": "Accessibility permission not granted"])
        return
    }
    
    let pid = app.processIdentifier
    let appRef = AXUIElementCreateApplication(pid)
    
    var menuBarVal: AnyObject?
    let menuBarErr = AXUIElementCopyAttributeValue(appRef, kAXMenuBarAttribute as CFString, &menuBarVal)
    guard menuBarErr == .success, let menuBar = menuBarVal else {
        printJSON(["ok": false, "error": "Failed to access simulator menu bar (AXError: \(menuBarErr.rawValue))"])
        return
    }
    
    var currentCandidates = getAXChildren(element: menuBar as! AXUIElement)
    var matchedElement: AXUIElement? = nil
    
    for (segIdx, segment) in pathSegments.enumerated() {
        let isLeaf = (segIdx == pathSegments.count - 1)
        var found: AXUIElement? = nil
        
        for candidate in currentCandidates {
            let title = getAXTitle(element: candidate) ?? ""
            if title.caseInsensitiveCompare(segment) == .orderedSame ||
               title.localizedCaseInsensitiveContains(segment) {
                found = candidate
                break
            }
            let subChildren = getAXChildren(element: candidate)
            for sub in subChildren {
                let subTitle = getAXTitle(element: sub) ?? ""
                if subTitle.caseInsensitiveCompare(segment) == .orderedSame ||
                   subTitle.localizedCaseInsensitiveContains(segment) {
                    found = candidate
                    break
                }
            }
            if found != nil { break }
        }
        
        guard let currentMatch = found else {
            printJSON([
                "ok": false,
                "error": "Menu item '\(segment)' not found in path '\(pathSegments.joined(separator: " > "))'"
            ])
            return
        }
        
        if isLeaf {
            matchedElement = currentMatch
        } else {
            currentCandidates = getSubmenuChildren(element: currentMatch)
        }
    }
    
    guard let targetElement = matchedElement else {
        printJSON(["ok": false, "error": "Could not resolve menu target"])
        return
    }
    
    let pressErr = AXUIElementPerformAction(targetElement, kAXPressAction as CFString)
    if pressErr == .success {
        printJSON(["ok": true, "path": pathSegments])
    } else {
        printJSON([
            "ok": false,
            "error": "Failed to perform press action on menu item '\(pathSegments.last ?? "")' (AXError: \(pressErr.rawValue))"
        ])
    }
}

// Main dispatcher
func main() {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let cmd = args.first else {
        printJSON(["error": "No command specified. Usage: macos-bridge <window-info|activate|click|drag|key|menu> [options]"])
        exit(1)
    }
    
    let subArgs = Array(args.dropFirst())
    switch cmd {
    case "window-info":
        handleWindowInfo()
    case "activate":
        handleActivate()
    case "click":
        handleClick(args: subArgs)
    case "drag":
        handleDrag(args: subArgs)
    case "key":
        handleKey(args: subArgs)
    case "menu":
        handleMenu(args: subArgs)
    default:
        printJSON(["error": "Unknown command: \(cmd)"])
        exit(1)
    }
}

main()
