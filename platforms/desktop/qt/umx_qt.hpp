// Ultra Motion X — Qt adapter (header-only, Qt 5.15 / Qt 6).
// Drives the engine with a precise timer at the screen refresh rate only while animating,
// and binds values to QObject properties (QWidget geometry, QQuickItem x/y/scale/opacity, …).
#pragma once

#include <QElapsedTimer>
#include <QGuiApplication>
#include <QHash>
#include <QObject>
#include <QPointer>
#include <QScreen>
#include <QTimer>
#include <QVariant>

#include "ultra_motion_x.hpp"

namespace umx {

class QtAnimator : public QObject {
    Q_OBJECT
public:
    explicit QtAnimator(QObject* parent = nullptr) : QObject(parent) {
        timer_.setTimerType(Qt::PreciseTimer);
        connect(&timer_, &QTimer::timeout, this, &QtAnimator::tick);
        clock_.start();
    }

    /// Springs `target.property` (numeric Q_PROPERTY) to `to`. Re-targeting keeps velocity.
    void spring(QObject* target, const char* property, double to, Spring s = {}, Priority p = Priority::Interaction) {
        const auto key = bindingKey(target, property);
        uint64_t v;
        auto it = bindings_.find(key);
        if (it == bindings_.end()) {
            v = engine_.create(target->property(property).toDouble());
            bindings_.insert(key, Binding{QPointer<QObject>(target), QByteArray(property), v});
        } else {
            v = it->value;
        }
        engine_.spring(v, to, s, p);
        wake();
    }

    void tween(QObject* target, const char* property, double to, double seconds) {
        const auto key = bindingKey(target, property);
        auto it = bindings_.find(key);
        uint64_t v = it == bindings_.end() ? engine_.create(target->property(property).toDouble()) : it->value;
        if (it == bindings_.end()) bindings_.insert(key, Binding{QPointer<QObject>(target), QByteArray(property), v});
        engine_.tween(v, to, seconds);
        wake();
    }

    Engine& engine() { return engine_; }

    /// QML convenience: springs the `x` property of an item.
    Q_INVOKABLE void springX(QObject* item, double to) { spring(item, "x", to); }
    Q_INVOKABLE void springProperty(QObject* item, const QString& property, double to) {
        const QByteArray p = property.toUtf8();
        spring(item, p.constData(), to);
    }

signals:
    void idle();

private:
    struct Binding {
        QPointer<QObject> target;
        QByteArray property;
        uint64_t value;
    };

    static QString bindingKey(QObject* o, const char* p) {
        return QString::number(reinterpret_cast<quintptr>(o)) + QLatin1Char(':') + QLatin1String(p);
    }

    void wake() {
        if (timer_.isActive()) return;
        const auto* screen = QGuiApplication::primaryScreen();
        const double hz = screen ? screen->refreshRate() : 60.0;
        timer_.start(std::max(1, static_cast<int>(1000.0 / (hz > 0 ? hz : 60.0))));
    }

    void tick() {
        const bool more = engine_.frame(static_cast<double>(clock_.nsecsElapsed()) / 1e6);
        for (auto it = bindings_.begin(); it != bindings_.end();) {
            if (!it->target) {  // target destroyed: release the value
                engine_.destroy(it->value);
                it = bindings_.erase(it);
                continue;
            }
            it->target->setProperty(it->property.constData(), engine_.get(it->value));
            ++it;
        }
        if (!more) {
            timer_.stop();
            emit idle();
        }
    }

    Engine engine_;
    QTimer timer_;
    QElapsedTimer clock_;
    QHash<QString, Binding> bindings_;
};

}  // namespace umx
