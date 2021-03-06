const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const St = imports.gi.St;
const Main = imports.ui.main;
const Tweener = imports.ui.tweener;
const PopupMenu = imports.ui.popupMenu;
const DND = imports.ui.dnd;
const SignalManager = imports.misc.signalManager;

let SpecialButtons, SpecialMenus, each, isEqual, constants;
if (typeof require !== 'undefined') {
  SpecialButtons = require('./specialButtons');
  SpecialMenus = require('./specialMenus');
  constants = require('./constants').constants;
  each = require('./each').each;
  isEqual = require('./isEqual').isEqual;
} else {
  const AppletDir = imports.ui.appletManager.applets['IcingTaskManager@json'];
  SpecialMenus = AppletDir.specialMenus;
  SpecialButtons = AppletDir.specialButtons;
  constants = AppletDir.constants.constants;
  each = AppletDir.each.each;
  isEqual = AppletDir.isEqual.isEqual;
}

function AppGroup () {
  this._init.apply(this, arguments);
}

AppGroup.prototype = {
  _init: function (params) {
    if (DND.LauncherDraggable) {
      DND.LauncherDraggable.prototype._init.call(this);
    }
    this._applet = params.appList._applet;
    this.appList = params.appList;
    this.signals = new SignalManager.SignalManager(this);
    this.launchersBox = this._applet;
    this.app = params.app;
    this.appId = params.appId;
    this.appName = this.app.get_name();
    this.autostartIndex = this._applet.autostartApps.findIndex(app => app.id === this.appId);
    this.isFavoriteApp = params.isFavoriteApp;
    this.wasFavapp = false;
    this.orientation = this._applet.orientation;
    this.metaWorkspace = params.metaWorkspace;
    this.metaWindows = params.metaWindows;
    this.time = params.time;
    this.ungroupedIndex = params.ungroupedIndex;
    this.lastFocused = params.metaWindow;
    this.focusState = false;
    this.willUnmount = false;

    if (!this.lastFocused) {
      this.isFavoriteApp = true;
    }

    this.actor = new St.Bin({
      reactive: true,
      can_focus: true,
      x_fill: true,
      y_fill: false,
      track_hover: true
    });
    this.appList.managerContainer.add_actor(this.actor);
    this.actor._delegate = this;

    this._appButton = new SpecialButtons.AppButton(this);
    this.actor.add_actor(this._appButton.actor);

    this.rightClickMenu = new SpecialMenus.AppMenuButtonRightClickMenu({
      parent: this,
      metaWindow: this.lastFocused,
      metaWindows: this.metaWindows
    });
    this._menuManager = new PopupMenu.PopupMenuManager(this);
    this._menuManager.addMenu(this.rightClickMenu);

    // Set up the hover menu for this._appButton
    this.hoverMenu = new SpecialMenus.AppThumbnailHoverMenu(this);
    this._hoverMenuManager = new SpecialMenus.HoverMenuController(this);
    this._hoverMenuManager.addMenu(this.hoverMenu);

    this._draggable = SpecialButtons.makeDraggable(this.actor);
    this.signals.connect(this._appButton.actor, 'button-release-event', Lang.bind(this, this._onAppButtonRelease));
    this.signals.connect(this._appButton.actor, 'button-press-event', Lang.bind(this, this._onAppButtonPress));
    this.signals.connect(this._draggable, 'drag-begin', Lang.bind(this, this._onDragBegin));
    this.signals.connect(this._draggable, 'drag-cancelled', Lang.bind(this, this._onDragCancelled));
    this.signals.connect(this._draggable, 'drag-end', Lang.bind(this, this._onDragEnd));
    this.isDraggableApp = true;
    this._calcWindowNumber(this.metaWindows);
  },

  _onDragBegin: function() {
    if (this._applet.orientation === St.Side.TOP || this._applet.orientation === St.Side.BOTTOM) {
      this._draggable._overrideY = this.actor.get_transformed_position()[1];
      this._draggable._overrideX = null;
    } else {
      this._draggable._overrideX = this.actor.get_transformed_position()[0];
      this._draggable._overrideY = null;
    }
  },

  _onDragEnd: function () {
    this.rightClickMenu.close(false);
    this.hoverMenu.close(false);
    this.appList._fixAppGroupIndexAfterDrag(this.appId);
    this._applet._clearDragPlaceholder();
  },

  _onDragCancelled: function () {
    this.rightClickMenu.close(false);
    this.hoverMenu.close(false);
    this._applet._clearDragPlaceholder();
  },

  handleDragOver: function (source, actor, x, y, time) {
    if (source instanceof AppGroup
      || source.isDraggableApp
      || (DND.LauncherDraggable && source instanceof DND.LauncherDraggable)
      || this._applet.panelEditMode) {
      return DND.DragMotionResult.CONTINUE;
    }
    if (this.metaWindows.length > 0 && this.lastFocused) {
      Main.activateWindow(this.lastFocused, global.get_current_time());
    }
    return true;
  },

  getDragActor: function () {
    return this.app.create_icon_texture(this._applet._panelHeight);
  },

  // Returns the original actor that should align with the actor
  // we show as the item is being dragged.
  getDragActorSource: function () {
    return this.actor;
  },

  showOrderLabel: function (number){
    this._appButton._numLabel.text = (number + 1).toString();
    this._appButton._numLabel.show();
  },

  _onAppButtonRelease: function(actor, event) {
    this._applet._clearDragPlaceholder();
    let button = event.get_button();

    let shouldStartInstance = (button === 1 && this.isFavoriteApp && this.metaWindows.length === 0
      || (button === 2 && this._applet.middleClickAction));

    let shouldEndInstance = button === 2 && !this._applet.middleClickAction && this.lastFocused;

    if (shouldStartInstance) {
      this.app.open_new_window(-1);
      this._animate();
      return;
    }

    if (shouldEndInstance) {
      this.lastFocused.delete(global.get_current_time());
      return;
    }

    let appWindows = this._applet.groupApps ? this.app.get_windows() : [this.metaWindows[0]];
    let appWindowsLen = appWindows.length;

    let handleMinimizeToggle = (win)=>{
      if (this._applet.onClickThumbs && appWindowsLen > 1) {
        if (this.hoverMenu.isOpen) {
          this.hoverMenu.close();
        } else {
          this.hoverMenu.open();
        }
        return;
      }
      if (win.appears_focused) {
        win.minimize();
      } else {
        Main.activateWindow(win, global.get_current_time());
      }
    };

    if (button === 1) {
      this.hoverMenu.shouldOpen = false;
      if (this.rightClickMenu.isOpen) {
        this.rightClickMenu.toggle();
      }
      if (appWindows.length === 1) {
        handleMinimizeToggle(appWindows[0]);
      } else {
        let actionTaken = false;
        for (let i = 0, len = appWindows.length; i < len; i++) {
          if (this.lastFocused && appWindows[i]._lgId === this.lastFocused._lgId) {
            handleMinimizeToggle(appWindows[i]);
            actionTaken = true;
            break;
          }
        }
        if (!actionTaken) {
          handleMinimizeToggle(appWindows[0]);
        }
      }
    } else if (button === 3) {
      if (!this.rightClickMenu.isOpen) {
        this.appList._closeAllRightClickMenus(()=>{
          this.appList._closeAllHoverMenus(()=>{
            this.rightClickMenu.open();
          });
        });
      } else {
        this.appList._closeAllRightClickMenus(Lang.bind(this, this.appList._closeAllHoverMenus));
      }
    }
  },

  _onAppButtonPress: function(actor, event){
    let button = event.get_button();
    if (button === 3) {
      return true;
    }
    return false;
  },

  _onAppKeyPress: function () {
    if (this.isFavoriteApp && this.metaWindows.length === 0) {
      this.app.open_new_window(-1);
      this._animate();
    } else {
      if (this.metaWindows.length > 1) {
        this.hoverMenu.open(true);
      } else {
        this.appList._closeAllHoverMenus();
      }
      this._windowHandle(false);
    }
  },

  _onNewAppKeyPress: function () {
    this.app.open_new_window(-1);
    this._animate();
  },

  _windowHandle: function (fromDrag) {
    let has_focus = this.lastFocused.has_focus();
    if (!this.lastFocused.minimized && !has_focus) {
      this.lastFocused.foreach_transient(function (child) {
        if (!child.minimized && child.has_focus()) {
          has_focus = true;
        }
      });
    }

    if (has_focus) {
      if (fromDrag) {
        return;
      }
      if (this.metaWindows.length > 1) {
        let nextWindow = null;
        for (let i = 0, max = this.metaWindows.length - 1; i < max; i++) {
          if (this.metaWindows[i]._lgId === this.lastFocused._lgId) {
            nextWindow = this.metaWindows[i + 1];
            break;
          }
        }
        if (nextWindow === null){
          nextWindow = this.metaWindows[0];
        }
        Main.activateWindow(nextWindow, global.get_current_time());
      } else {
        this.lastFocused.minimize();
        this.actor.remove_style_pseudo_class('focus');
      }
    } else {
      if (this.lastFocused.minimized) {
        this.lastFocused.unminimize();
      }
      let ws = this.lastFocused.get_workspace().index();
      if (ws !== global.screen.get_active_workspace_index()) {
        global.screen.get_workspace_by_index(ws).activate(global.get_current_time());
      }
      Main.activateWindow(this.lastFocused, global.get_current_time());
      this.actor.add_style_pseudo_class('focus');
    }
  },

  _shouldWindowBeAdded: function(metaWindow) {
    let windowAddArgs = metaWindow != null || !this._applet.groupApps;
    if (!this._applet.includeAllWindows) {
      windowAddArgs = windowAddArgs && this._applet.tracker.is_window_interesting(metaWindow);
    }
    if (this._applet.panel && metaWindow && this._applet.listMonitorWindows) {
      windowAddArgs = windowAddArgs && (this._applet._monitorWatchList.indexOf(metaWindow.get_monitor()) > -1 || this._applet._monitorWatchList.length === 0);
    }
    return windowAddArgs;
  },

  _windowAdded: function (metaWindow, metaWindows) {
    if (metaWindows) {
      this.metaWindows = [];
      for (var i = 0; i < metaWindows.length; i++) {
        if (this._shouldWindowBeAdded(metaWindows[i])) {
          this.metaWindows.push(metaWindows[i]);
        }
      }
    }
    let refWindow = this.metaWindows.findIndex(win => {
      return isEqual(win, metaWindow);
    });
    let windowAddArgs = this._shouldWindowBeAdded(metaWindow);
    if (windowAddArgs) {
      if (metaWindow) {
        this.lastFocused = metaWindow;
        this.signals.connect(metaWindow, 'notify::title', Lang.bind(this, this._windowTitleChanged));
        this.signals.connect(metaWindow, 'notify::appears-focused', Lang.bind(this, this._focusWindowChange));
        this.signals.connect(metaWindow, 'notify::gtk-application-id', this._onAppChange);
        this.signals.connect(metaWindow, 'notify::wm-class', this._onAppChange);
        if (metaWindow.progress !== undefined) {
          this._appButton._progress = metaWindow.progress;
          if (this._appButton._progress > 0) {
            this._appButton.progressOverlay.add_style_pseudo_class('progress');
          }
          this.signals.connect(metaWindow, 'notify::progress', () => this._appButton._onProgressChange(metaWindow));
        } else {
          this._appButton.progressOverlay.visible = false;
        }

        // Set the initial button label as not all windows will get updated via signals initially.
        this._windowTitleChanged(metaWindow);
        if (refWindow === -1) {
          this.metaWindows.push(metaWindow);
        }
        this._calcWindowNumber(this.metaWindows);
        this._appButton._onFocusChange();
      }

      this.rightClickMenu.setMetaWindow(this.lastFocused, this.metaWindows);
      this.hoverMenu.setMetaWindow(this.lastFocused, this.metaWindows);
      this.hoverMenu.appSwitcherItem._refreshThumbnails();
      this._appButton.setMetaWindow(this.lastFocused, this.metaWindows);
      this._isFavorite(this.isFavoriteApp);
    }
  },

  _windowRemoved: function (metaWorkspace, metaWindow, refWindow, cb) {
    if (refWindow === -1) {
      return false;
    }
    this.signals.disconnect('notify::title', metaWindow);
    this.signals.disconnect('notify::appears-focused', metaWindow);
    this.signals.disconnect('notify::gtk-application-id', metaWindow);
    this.signals.disconnect('notify::wm-class', metaWindow);

    this.metaWindows.splice(refWindow, 1);
    this._calcWindowNumber(this.metaWindows);
    if (this.metaWindows.length > 0 && !this.willUnmount) {
      if (this._appButton.progressOverlay.visible && metaWindow.progress > 0) {
        this._appButton._progress = 0;
        this._appButton.progressOverlay.visible = false;
      }
      this.lastFocused = this.metaWindows[this.metaWindows.length - 1];
      this.hoverMenu.setMetaWindow(this.lastFocused, this.metaWindows);
      this._windowTitleChanged(this.lastFocused);
      /*
        Workaround for #86 - https://github.com/jaszhix/icingtaskmanager/issues/86
        this.hoverMenu.setMetaWindow is being called after this.hoverMenu.open calls
        this.hoverMenu.appSwitcherItem._refresh with an outdated metaWindows cache. Better fix TBD.
      */
      this.hoverMenu.appSwitcherItem.removeStaleWindowThumbnails(this.metaWindows);
      if (this.rightClickMenu !== undefined) {
        this.rightClickMenu.setMetaWindow(this.lastFocused, this.metaWindows);
      }
      this.hoverMenu.appSwitcherItem._refreshThumbnails();
      this._appButton.setMetaWindow(this.lastFocused, this.metaWindows);
    } else {
      // This is the last window, so this group needs to be destroyed. We'll call back _windowRemoved
      // in appList to put the final nail in the coffin.
      if (typeof cb === 'function') {
        cb(this.appId, this.isFavoriteApp);
      }
    }
  },

  _onAppChange: function(metaWindow) {
    this.appList._windowRemoved(this.metaWorkspace, metaWindow);
    if (!this.appList) {
      return;
    }
    this.appList._windowAdded(this.metaWorkspace, metaWindow);
  },

  _windowTitleChanged: function (metaWindow) {
    if (this.willUnmount) {
      return false;
    }
    if (!metaWindow || (this.metaWindows.length === 0 && this.isFavoriteApp)) {
      this._appButton.hideLabel();
      return false;
    }
    let title = metaWindow.get_title();
    each(this.hoverMenu.appSwitcherItem.appThumbnails, (thumbnail)=>{
      if (isEqual(thumbnail.metaWindow, metaWindow)) {
        thumbnail._label.set_text(title);
        return false;
      }
    });
    let titleType = this._applet.settings.getValue('title-display');
    this.appName = this.app.get_name();
    if (titleType === constants.TitleDisplay.None
      || (this.orientation === St.Side.LEFT || this.orientation === St.Side.RIGHT)) {
      this._appButton.setText('');
    } else if (titleType === constants.TitleDisplay.Title) {
      if (title) {
        this._appButton.setText(title);
        this._appButton.showLabel(true);
      }
    } else if (titleType === constants.TitleDisplay.Focused) {
      if (title) {
        this._appButton.setText(title);
        this._updateFocusedStatus(true);
      }
    } else if (titleType === constants.TitleDisplay.App) {
      if (this.appName) {
        this._appButton.setText(this.appName);
        this._appButton.showLabel(true);
      }
    }
  },

  _focusWindowChange: function (metaWindow) {
    if (metaWindow.appears_focused) {
      this.appList._setLastFocusedApp(this.appId);
      this.lastFocused = metaWindow;
      this._windowTitleChanged(this.lastFocused);
      each(this.hoverMenu.appSwitcherItem.appThumbnails, (thumbnail)=>{
        thumbnail._focusWindowChange();
      });
      if (this._applet.sortThumbs) {
        this.hoverMenu.setMetaWindow(this.lastFocused, this.metaWindows);
      }
      if (this.rightClickMenu !== undefined) {
        this.rightClickMenu.setMetaWindow(this.lastFocused, this.metaWindows);
      }
    }
    if (this._applet.settings.getValue('title-display') === constants.TitleDisplay.Focused) {
      this._updateFocusedStatus();
    }
  },

  _updateFocusedStatus: function (force) {
    let focusState;
    for (let i = 0, len = this.metaWindows.length; i < len; i++) {
      if (this.metaWindows[i].appears_focused) {
        focusState = this.metaWindows[i];
        break;
      }
    }
    if (this.focusState !== focusState || force) {
      if (focusState) {
        this._appButton.showLabel(true);
      } else {
        this._appButton.hideLabel(true);
      }
    }
    this.focusState = focusState;
  },

  _isFavorite: function (isFav) {
    this.isFavoriteApp = isFav;
    this.wasFavapp = !isFav;
    this._appButton._isFavorite(isFav);
    if (this.metaWindows.length === 0) {
      this.hoverMenu.appSwitcherItem._isFavorite(isFav);
      this.hoverMenu.close();
    }
    this._windowTitleChanged(this.lastFocused);
  },

  _calcWindowNumber: function () {
    if (this.willUnmount) {
      return false;
    }

    let windowNum = this.metaWindows ? this.metaWindows.length : 0;

    this._appButton._numLabel.text = windowNum.toString();
    if (this._applet.numDisplay === constants.NumberDisplay.Smart) {
      if (windowNum <= 1) {
        this._appButton._numLabel.hide();
      } else {
        this._appButton._numLabel.show();
      }
    } else if (this._applet.numDisplay === constants.NumberDisplay.Normal) {
      if (windowNum <= 0) {
        this._appButton._numLabel.hide();
      }
      else {
        this._appButton._numLabel.show();
      }
    } else if (this._applet.numDisplay === constants.NumberDisplay.All) {
      this._appButton._numLabel.show();
    } else {
      this._appButton._numLabel.hide();
    }
  },

  _animate: function () {
    this.actor.set_z_rotation_from_gravity(0.0, Clutter.Gravity.CENTER);
    Tweener.addTween(this.actor, {
      opacity: 70,
      time: 1.0,
      transition: 'linear',
      onCompleteScope: this,
      onComplete: function () {
        Tweener.addTween(this.actor, {
          opacity: 255,
          time: 0.5,
          transition: 'linear'
        });
      }
    });
  },

  destroy: function (skipRefCleanup) {
    this.signals.disconnectAllSignals();
    this.willUnmount = true;

    if (this.rightClickMenu) {
      this.rightClickMenu.destroy();
    }

    this.hoverMenu.destroy();
    this._appButton.destroy();
    this.appList.managerContainer.remove_child(this.actor);
    this.actor.destroy();

    if (!skipRefCleanup) {
      let props = Object.keys(this);
      each(props, (propKey)=>{
        this[propKey] = undefined;
      });
    }
  }
};