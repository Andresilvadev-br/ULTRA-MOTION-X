// Qt Quick example: a panel springs in/out when the button is clicked.
#include <QGuiApplication>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include "../umx_qt.hpp"

int main(int argc, char** argv) {
    QGuiApplication app(argc, argv);
    umx::QtAnimator animator;
    QQmlApplicationEngine qml;
    qml.rootContext()->setContextProperty("umxAnimator", &animator);
    qml.loadData(R"(
      import QtQuick
      import QtQuick.Controls
      ApplicationWindow {
        width: 640; height: 400; visible: true
        property bool open: false
        Rectangle { id: panel; objectName: "panel"; width: 260; height: parent.height; x: -260; color: "#1d2236" }
        Button { text: "Toggle"; anchors.centerIn: parent
          onClicked: { open = !open; umxAnimator.springX(panel, open ? 0 : -260) } }
      }
    )");
    return app.exec();
}
